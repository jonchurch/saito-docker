//
// we do not 'use strict' in this class because
// we need the ability to delete items from a
// map when processing our transient blockchain
//
// see:
//
//    purgeArchivedBlocks
//

const saito   = require('../saito');


/////////////////
// Constructor //
/////////////////
function Blockchain(app) {

  if (!(this instanceof Blockchain)) { return new Blockchain(app); }

  this.app     = app || {};


  /////////////////////////
  // Consensus Variables //
  /////////////////////////
  //
  // variables governing the monetary policy for the
  // network are in the block class (treasury, token
  // limit, etc.)
  //
  this.heartbeat               = 30;        // expect new block every 30 seconds
  this.max_heartbeat           = 120;       // burn fee hits zero every 120 seconds
  this.genesis_period          = 12160;     // number of blocks before money disappears
					    // 90,000 is roughly a 30 day transient blockchain.
  this.genesis_ts              = 0;         // unixtime of earliest block
  this.genesis_block_id        = 0;         // earliest block_id we care about
  this.fork_guard              = 120;       // discard forks that fall N blocks behind, this can
					    // result in a chain fork, so this needs to be long
					    // enough that we reasonably decide that nodes that
					    // cannot keep up-to-date with the network must resync
					    //
					    // the fork guard is used primarily when identifying
					    // what blocks we can delete, since we must have the
					    // full genesis period, plus whatever fork guard limit
					    // suggests that someone can re-write the genesis chain
					    //
  this.fork_id                 = "";        // a string we use to identify our longest-chain
					    // generated deterministically from the block hashes
					    // and thus unique for every fork
					    //
  this.fork_id_mod             = 10;	    // update fork id every 10 blocks
  this.old_lc                  = -1;	    // old longest-chain when processing new block
					    // this will be set to the position of the current
					    // head of the longest chain in our indexes before
					    // we try to validate the newest block, so that we
					    // can gracefully reset to the known-good block if
					    // there are problems


  /////////////
  // Indexes //
  /////////////
  //
  // These hold the most important data needed to interact
  // with the blockchain objects, and must be kept for the
  // entire period the block is part of the transient
  // blockchain.
  //
  // If we add or delete these items, we must make changes
  // to the following functions
  //
  //    addBlockToBlockchain (add)
  //    addBlockToBlockchainPartTwo (lc_hashmap only)
  //    purgeArchivedData (delete)
  //
  this.index = {
    hash:        [],                 // hashes
    prevhash:    [],                 // hash of previous block
    block_id:    [],                 // block id
    mintid:      [],                 // min tid
    maxtid:      [],                 // max tid
    ts:          [],                 // timestamps
    lc:          [],                 // is longest chain (0 = no, 1 = yes)
    burnfee:     []                  // burnfee per block
  };
  this.blocks         = [];
  this.block_hashmap  = [];
  this.lc_hashmap     = []; 	     // hashmap index is the  block hash and contains
				     // 1 or 0 depending on if they are the longest
				     // chain or not.
  this.longestChain   = -1;          // position of longest chain in indices


  ///////////////////
  // monitor state //
  ///////////////////
  this.currently_indexing = 0;
  this.currently_reclaiming = 0;
  this.block_saving_timer = null;
  this.block_saving_timer_speed = 10;


  //
  // this are set to the earliest block that we process
  // to ensure that we don't load missing blocks endlessly
  // into the past.
  //
  // the blk_limit is checked in the storage class when
  // validating slips as part of its sanity check so that
  // it does not cry foul if it lacks a full genesis period
  // worth of blocks but cannot validate slips.
  //
  this.ts_limit = -1;
  this.blk_limit = -1;


  ///////////////
  // Callbacks //
  ///////////////
  this.callback_limit 	       = 100;        // only run callbacks on the last X blocks
					     // this should be at least 10 to be safe, as
					     // we delete data from blks past this limit
					     // and that can complicate syncing to lite-clients
					     // if we send full blocks right away
  this.run_callbacks 	       = 1;	     // 0 for central nodes focused on scaling


  //
  // these are used to tell the blockchain class from
  // what block it should start syncing. we load these
  // from our options file on initialize.
  //
  this.previous_block_id = -1;
  this.previous_ts_limit = -1;
  this.previous_block_hash = "";

  return this;

}
module.exports = Blockchain;



////////////////
// initialize //
////////////////
//
// checks to see if we have any blocks on disk and starts
// adding them to our blockchain. updates local variables
// to let us know our latest block, block hash, etc. for
// lite-clients.
//
// Once blocks are reindexed, the software will continue
// to sync missing data from the blockchain using the 
// information read in from the options file.
//
Blockchain.prototype.initialize = function initialize() {
  this.app.storage.loadBlocksFromDisk(this.genesis_period+this.fork_guard);
  if (this.app.options.blockchain != undefined) {
    if (this.app.options.blockchain.latest_block_id != null) {
      this.previous_block_id = this.app.options.blockchain.latest_block_id;
    }
    if (this.app.options.blockchain.latest_block_ts != null) {
      this.previous_ts_limit = this.app.options.blockchain.latest_block_ts;
    }
    if (this.app.options.blockchain.latest_block_hash != null) {
      this.previous_block_hash = this.app.options.blockchain.latest_block_hash;
    }
  }
}


////////////////////////////////////
// validateBlockAndQueueInMempool //
////////////////////////////////////
//
// this function makes sure that everything about the block
// is valid except for the input slips, which we check only
// when we make this part of the longest chain.
//
// it is called only when we receive a block over the network
// as we already trust our own blocks to validate. if the
// block is considered superficially valid, we add it to the
// FIFO mempool queue and (optionally) propagate it to our
// peers.
//
// @params {saito.block} block
// @params {boolean} propagate to peers
//
Blockchain.prototype.validateBlockAndQueueInMempool = function validateBlockAndQueueInMempool(blk, relay_on_validate=1) {

  //////////////////////
  // check if indexed //
  //////////////////////
  if ( this.isHashIndexed( blk.returnHash() ) == 1 ) {
    console.log("Hash is already indexed: " + blk.returnHash() );
    return 0;
  }

  blockchain_self = this;

  ////////////////////
  // validate block //
  ////////////////////
  blk.validate(function(is_block_valid=0, prevblk=null) {

    if (is_block_valid == 0) {
      console.log("Block does not validate!!!");
      blockchain_self.app.mempool.removeBlock(blk);
      console.log("INVALID BLOCK HASH: " + blk.returnHash());
      blk.block.transactions = [];
      blk.transactions = [];
      console.log(JSON.stringify(blk.block, null, 4));
      return 0;
    }


    ////////////////////////////
    // validate golden ticket //
    ////////////////////////////
    if (! blk.validateGoldenTicket(prevblk) ) {
      console.log("Block does not validate -- Golden Ticket Wrong!!!");
      blockchain_self.app.mempool.removeBlock(blk);
      return 0;
    }

    //////////////////////////////
    // validate monetary policy //
    //////////////////////////////
    blockchain_self.currently_reclaiming = 1;
    blk.validateReclaimedFunds(function(validated_or_not) {

      if (validated_or_not == 0) {
        console.log("Reclaimed Funds found invalid");
        blockchain_self.app.mempool.removeBlock(blk);
        blockchain_self.currently_reclaiming = 0;
        return 0;
      }

      ///////////////////////////////
      // add to FIFI mempool queue //
      ///////////////////////////////
      if ( ! blockchain_self.app.mempool.addBlock(blk) ) {
        blockchain_self.currently_reclaiming = 0;
        return 0;
      }

      ///////////////
      // propagate //
      ///////////////
      if (relay_on_validate == 1) {
        blockchain_self.app.network.propagateBlock(blk);
      }

      /////////////
      // process //
      /////////////
      blockchain_self.currently_reclaiming = 0;
      blockchain_self.app.mempool.processBlocks();

    });
  });

}


//////////////////////////
// addBlockToBlockchain //
//////////////////////////
//
// this is the heart of the blockchain class. the blocks that are
// submitted here are pulled out of the mempool FIFO queue, which
// means that EITHER we created them OR they have already been
// superficially validated (i.e. everything but the transaction
// slips).
//
// we only process one block at a time, add it to our in-memory
// array of blocks and then check to see if it is part of the
// longest chain. if it is NOT we can continue with:
//
//   addBlockToBlockchainPartTwo
//
// if the block IS part of the longest chain or we are facing a chain
// reorganization we need to submit it to the Storage class so that
// we can validate the slips.
//
//   validateLongestChain
//
// The function ends at this point because the Storage class may
// need to fetch older blocks from disk in order to properly
// validate them, and so we have no control over executing once
// we his this point.
//
// Once the slips are validated, control passes to one of these
// two functions depending on whether this block successfully
// validated all of its slips. These either continue or reset
// the blockchain for the next block/
//
//   addBlockToBlockchainPartTwo
//   addBlockToBlockchainFailure
//
// @params {saito.block} block to add
// @params {string} "force" if loading from disk and
//		    we want to skip running callbacks
//
// @returns {boolean} can we delete this block from our mempool
//
Blockchain.prototype.addBlockToBlockchain = function addBlockToBlockchain(newblock, forceAdd="no") {


  console.log(" ... blockchain add");

  //
  // are we ready to add another block?
  //
  if (this.app.monitor.readyToAddBlockToBlockchain() == 0) {
    console.log("waiting to addBlockToBlockchain for: " + newblock.returnHash());
    return 0;
  } else {
    this.currently_indexing == 1;
  }

  //
  // sanity check
  //
  if (newblock == null || newblock.is_valid == 0) {
    console.log("BLOCK IS INVALID");
    this.currently_indexing = 0;
    return 1;
  }


  //
  // another sanity check
  //
  // TODO - hunt this down
  // 
  // there is some edge case where we will produce a block #1 
  // from OUR mempool and set it as the longest chain even if 
  // we already have a longest chain. So we refuse to add a 
  // block #1 if we already have any blocks in our queue.
  //
  // worst case is that some other blocks now need to start from
  // block 2 when syncing if they receive block #1 later than 
  // a subsequent block;
  //
  //if (newblock.block.id == 1 && this.index.hash.length > 0) { 
  //  console.log("ERROR: caught block #1 being produced!");
  //  console.log(JSON.stringify(newblock.block));
  //  process.exit();
  //  return 1; 
  //}



  var blockchain_self = this;

  let hash                  = newblock.returnHash('hex');
  let ts                    = newblock.block.unixtime;
  let prevhash              = newblock.block.prevhash;
  let block_id              = newblock.block.id;
  let old_longestChain      = this.longestChain;
  this.old_lc               = this.longestChain;


  //
  // we can delete this, just using it to get a sense
  // of how long various parts of block processing take
  // for optimization purposes
  //
  var startTime = new Date().getTime();
  console.log("\n\n\nSTART TIME: "+startTime);
  console.log("Adding block "+block_id + " -> " + hash + " " + newblock.block.unixtime);

  //
  // if the timestamp for this block is BEFORE our genesis block, we
  // refuse to process it out of principle. Our sorting algorithm will
  // still accept orphan chains that post-date our genesis block, but
  // will not try to connect them with the chain. it is a requirement
  // that the first block we receive is part of the valid longest chain
  //
  // we should implement something in the future that allows us to be
  // notified in the rare case there is a reorganization that pushes
  // our initial block out-of-sync. This will not happen to a node that
  // has a fully genesis period of blocks though, and has checked that
  // it is valid, so it is not a priority.
  //
  // this prevents us trying to load blocks endlessly into the past as
  // we find references to previous block hashes that we do not have
  // indexed in the historical blocks we are onboarding.
  //
  if (ts < this.genesis_ts) {
    if (forceAdd != "force") {
      this.currently_indexing = 0;
      return 1;
    }
  }
  if (this.isHashIndexed(hash) == 1) {
    this.currently_indexing = 0;
    return 1;
  }


  ////////////////////
  // missing blocks //
  ////////////////////
  //
  // if we are adding our first block, we set this as
  // the ts_limit to avoid requesting missing blocks
  // ad infinitum into the past. we update the blk_limit
  // variable so the storage class can check what our
  // earliest block_id is.
  //
  if (this.ts_limit == -1) {
    this.blk_limit = block_id;
    if (this.app.options.blockchain != null) {
      this.ts_limit = this.previous_ts_limit;
    }
    if (this.ts_limit == -1) {
      this.ts_limit = newblock.block.unixtime;
    }
  } else {
    if (this.ts_limit > newblock.block.unixtime && forceAdd != "no") {
      this.ts_limit = newblock.block.unixtime;
    }
  }

  //
  // if our previous block hash was not indexed we request the missing
  // block unless its timestamp is going to precede our first block
  // and genesis block, in which case we don't need it.
  //
  if (prevhash != "") {
    if (this.ts_limit <= newblock.block.unixtime) {
      if (this.isHashIndexed(prevhash) == -1) {
        var response           = {};
        response.request       = "missing block";
        response.data          = {};
        response.data.hash     = prevhash;
        response.data.lasthash = this.returnLatestBlockHash();
        this.app.network.sendRequest(response.request, JSON.stringify(response.data));
      }
    }
  }


  ////////////////////
  // insert indexes //
  ////////////////////
  var pos = this.binaryInsert(this.index.ts, ts, function(a,b) { return a -b;});
  this.index.hash.splice(pos, 0, hash);
  this.index.prevhash.splice(pos, 0, prevhash);
  this.index.block_id.splice(pos, 0, block_id);
  this.index.maxtid.splice(pos, 0, newblock.returnMaxTxId());
  this.index.mintid.splice(pos, 0, newblock.returnMinTxId());
  this.index.lc.splice(pos, 0, 0);              // set longest chain to 0 until we know it is longest chain
  this.index.burnfee.splice(pos, 0, newblock.returnBurnFee());
  this.block_hashmap[hash] = block_id;
  this.blocks.splice(pos, 0, newblock);



  //////////////////////////////////////////////////////////
  // if this is our first block, it is longest by default //
  //////////////////////////////////////////////////////////
  if (this.longestChain == -1) { this.longestChain = 0; }


  //////////////////////////////////////////////
  // decrypt any transactions intended for us //
  //////////////////////////////////////////////
  //
  // we handle during indexing to so that
  // modules can execute properly, i.e.
  // modules ask for either the decrypted
  // or original message using the
  // returnMessage function.
  //
  newblock.decryptTransactions();



  ///////////////////////////
  // calculate average fee //
  ///////////////////////////
  newblock.returnAverageFee();


  /////////////////////
  // affix callbacks //
  /////////////////////
  this.blocks[pos].affixCallbacks();


  /////////////////////////////
  // track the longest chain //
  /////////////////////////////
  var i_am_the_longest_chain    = 0;
  var shared_ancestor_index_pos = -1;
  var validate_transactions     = -1;
  var rewrite_longest_chain     = 0;
  var rewrite_nchain_len        = 0;
  var rewrite_lchain_len        = 0;
  var rewrite_forceAdd          = "";

  //
  // possibly adjust longestChain forward
  // if we stuck our block earlier in a
  // position earlier in the chain
  //
  if (pos <= this.longestChain) {
    this.longestChain++;
    if (this.longestChain >= this.index.hash.length) {
      this.longestChain--;
    }
  }

  //
  // if we are the genesis block, we are the longest chain
  //
  if (prevhash == "" && this.index.prevhash.length == 1) {
    this.longestChain = 0;
    i_am_the_longest_chain = 1;
  }

  //
  // first block from reset blockchains
  //
  if (this.previous_block_id != null) {
    if (this.index.hash.length == 1 && this.previous_block_id == newblock.returnId()-1) {
      this.longestChain = 0;
      i_am_the_longest_chain = 1;
    }
  }


  ////////////////////////////
  // IDENTIFY LONGEST CHAIN //
  ////////////////////////////
  //
  // we go through our index and figure out if the block
  // we are adding is part of the longest chain, and whether
  // making it the longest chain will require re-writing the
  // chain. this will set the variable
  //
  //   i_am_the_longest_chain
  //
  // to 1 if we think we are on the longest chain or to 0
  // if we are not. The rest of our block-addition code
  // needs to know whether we are longest-chain, so we do
  // it here first.
  //
  if (block_id >= this.index.block_id[this.longestChain]) {
    if (prevhash == this.index.hash[this.longestChain] || prevhash == this.previous_block_hash) {

      // if prev is longest
      this.longestChain = pos;
      i_am_the_longest_chain = 1;
      validate_transactions = 1;

    } else {

      //
      // otherwise, we find the last shared ancestor and
      // calculate the length and aggregate burn fee of
      // the two competing chains to determine which is
      // preferred
      //

      var lchain_pos = this.longestChain;
      var nchain_pos = pos;
      var lchain_len = 0;
      var nchain_len = 0;
      var lchain_brn = this.index.burnfee[lchain_pos];
      var nchain_brn = this.index.burnfee[nchain_pos];
      var lchain_ts  = this.index.ts[lchain_pos];
      var nchain_ts  = this.index.ts[nchain_pos];
      var lchain_ph  = this.index.prevhash[lchain_pos];
      var nchain_ph  = this.index.prevhash[nchain_pos];

      var search_pos = null;
      var search_ts  = null;
      var search_hash= null;
      var search_ph  = null;
      var search_brn = null;

      var ancestor_precedes_current = 0;

      if (nchain_ts >= lchain_ts) {
        search_pos = nchain_pos-1;
      } else {
        ancestor_precedes_current = 1;
        search_pos = lchain_pos-1;
      }

      while (search_pos >= 0) {

        search_ts    = this.index.ts[search_pos];
        search_hash  = this.index.hash[search_pos];
        search_ph    = this.index.prevhash[search_pos];
        search_brn   = this.index.burnfee[search_pos];

        if (search_hash == lchain_ph && search_hash == nchain_ph) {
          shared_ancestor_index_pos = search_pos;
          search_pos = -1;
        } else {
          if (search_hash == lchain_ph) {
            lchain_len++;
            lchain_ph    = this.index.prevhash[search_pos];
  	    lchain_brn  = parseFloat(lchain_brn) + parseFloat(this.index.burnfee[search_pos]);
          }
          if (search_hash == nchain_ph) {
            nchain_ph    = this.index.prevhash[search_pos];
            nchain_len++;
	    // this may be inexact, but as long as javascript errors
	    // work the same way on all machines... i.e. hack but
	    // good enough for now
	    nchain_brn  = parseFloat(nchain_brn) + parseFloat(this.index.burnfee[search_pos]);
          }

	  shared_ancestor_index_pos = search_pos;
          search_pos--;
        }
      }


      if (nchain_len > lchain_len && nchain_brn >= lchain_brn) {

        //
        // to prevent our system from being gamed, we
        // require the attacking chain to have equivalent
        // or greater aggregate burn fees. This ensures that
        // an attacker cannot lower difficulty, pump out a
        // ton of blocks, and then hike the difficulty only
        // at the last moment.
        //

        console.log("UPDATING LONGEST CHAIN: "+nchain_len + " new |||||| " + lchain_len + " old 1");

        i_am_the_longest_chain = 1;
        rewrite_longest_chain  = 1;
	rewrite_nchain_len     = nchain_len;
	rewrite_lchain_len     = lchain_len;
	rewrite_forceAdd       = forceAdd;
        validate_transactions  = nchain_len;

     } else {

        //
        // we have a choice of which chain to support, and we
       	// support whatever chain matches our preferences
        //
        if (nchain_len == lchain_len && nchain_brn >= lchain_brn) {

          latestBlock = this.returnLatestBlock();
          if (latestBlock != null) {
            if (this.app.voter.prefers(newblock, latestBlock)) {

              console.log("UPDATING LONGEST CHAIN W/ PREFERENCE: "+nchain_len + " new |||||| " + lchain_len + " old 2");

              i_am_the_longest_chain = 1;
              rewrite_longest_chain  = 1;
              rewrite_nchain_len     = nchain_len;
              rewrite_lchain_len     = lchain_len;
              rewrite_forceAdd       = forceAdd;
              validate_transactions  = nchain_len;

            }
          }
        }
      }
    }
  } else {

    //
    // this catches an edge case that happens if we ask for blocks starting from
    // id = 132, but the first block we RECEIVE is a later block in that chain,
    // such as 135 or so.
    //
    // in this case our blockchain class will treat the first block as the starting
    // point and we run into issues unless we explicitly reset the blockchain to
    // treat block 132 as the proper first block.
    //
    // so we reset this to our first block and mark it as part of the longest chain
    // the network will figure this out in time as further blocks build on it.
    //
    if (newblock.block.prevhash == this.previous_block_hash && newblock.block.prevhash != "") {

      // reset later blocks to non-longest chain
      for (let h = pos+1; h < this.index.lc.length; h++) {
        this.index.lc[h] = 0;
        this.app.storage.onChainReorganization(this.index.block_id[h], this.index.hash[h], 0);
        this.app.wallet.onChainReorganization(this.index.block_id[h], this.index.hash[h], 0);
        this.app.modules.onChainReorganization(this.index.block_id[h], this.index.hash[h], 0);
      }

      // insist that I am the longest chain
      i_am_the_longest_chain = 1;
      this.previous_block_hash = hash;
      this.longestChain = pos;
      this.app.modules.updateBalance();

      //
      // we do not need to worry about updating the slips
      //
      // the blocks we reset will be reset as lc = 1 when
      // the next block comes in that has a full chain
      // starting from this block
      //

    }
  }


  ////////////////////////////////
  // validate the longest chain //
  ////////////////////////////////

  //
  // if we are on the longest chain we have to validate our transaction
  // slips. In order to do this, we creep through the number of blocks
  // on the new_chain and validate them one-by-one. We must revalidate
  // starting from the oldest block in order to be sure that our sliips
  // are all valid.
  //
  // if there is a problem validating a block, we reset ourselves
  // to the previous longest chain and abort the entire process,
  // so that we never even hit the block purge and/or callback stage
  //
  // if a block is not on the longest chain, we skip the validation
  // and move on to adding inputs to wallets, etc.
  //

  if (i_am_the_longest_chain == 1) {

    //////////////////
    // reset miners //
    //////////////////
    this.longestChain = pos;
    this.index.lc[pos] = 1;
    this.app.miner.stopMining();

    this.app.miner.startMining(newblock);
    this.app.options.blockchain = this.returnBlockchain();
    this.app.storage.saveOptions();


    //////////////////////////////////////////
    // get hashes and indexes of two chains //
    //////////////////////////////////////////
    var shared_ancestor_hash = this.index.hash[shared_ancestor_index_pos];
    var new_hash_to_hunt_for = newblock.returnHash('hex');
    var new_block_hashes     = [];
    var new_block_idxs       = [];
    var new_block_ids        = [];
    var old_hash_to_hunt_for = this.index.hash[old_longestChain];
    var old_block_hashes     = [];
    var old_block_idxs       = [];
    var old_block_ids        = [];


    if (newblock.block.prevhash == old_hash_to_hunt_for) {

      // we have no competing chain, just the
      // new block claiming to be building on
      // the existing chain
      new_block_hashes.push(this.index.hash[pos]);
      new_block_idxs.push(pos);
      new_block_ids.push(this.index.block_id[pos]);

    } else {

      ///////////////////////
      // old longest chain //
      ///////////////////////
      for (let j = this.index.hash.length-1; j > shared_ancestor_index_pos; j--) {
        if (this.index.hash[j] == old_hash_to_hunt_for) {
          old_hash_to_hunt_for = this.index.prevhash[j];
          old_block_hashes.push(this.index.hash[j]);
          old_block_idxs.push(j);
          old_block_ids.push(this.index.block_id[j]);
        }
      }
      old_block_hashes.reverse();
      old_block_idxs.reverse();

      ///////////////////////
      // new longest chain //
      ///////////////////////
      for (let j = this.index.hash.length-1; j > shared_ancestor_index_pos; j--) {
        if (this.index.hash[j] == new_hash_to_hunt_for) {
          new_hash_to_hunt_for = this.index.prevhash[j];
          new_block_hashes.push(this.index.hash[j]);
          new_block_idxs.push(j);
          new_block_ids.push(this.index.block_id[j]);
        }
      }
      new_block_hashes.reverse();
      new_block_idxs.reverse();

    }

    //
    // we are longest chain, so we have to unwind the old chain
    // and wind the new chain. If there is no old chain we will
    // just wind the new chain directly.
    //
console.log("validate longest chain...");
    this.app.storage.validateLongestChain(newblock, pos, shared_ancestor_index_pos, new_block_idxs, new_block_hashes, new_block_ids, old_block_idxs, old_block_hashes, old_block_idxs, i_am_the_longest_chain, forceAdd);

  } else {

    //
    // we are not longest-chain, so we jump directly
    // to the second part of the block addition
    //
console.log("direct to part II...");
    this.addBlockToBlockchainPartTwo(newblock, pos, i_am_the_longest_chain, forceAdd);
  }

  // delete from mempool
  return 1;

}


/////////////////////////////////
// addBlockToBlockchainFailure //
/////////////////////////////////
//
// this function gets called if we fail to validate the LongestChain.
//
// in that case, we get kicked out here, with our transaction slips all
// reset to whatever our original slips were like before we made the
// valiant effort to add this failure-of-a-block in the first place.
//
// this function needs to reset our blockchain class to a state of
// normality so that we can continue to process the next block.
//
// @params {saito.block} block
// @params {integer} position of block in indexes
// @params {integer} is block in longest chain
// @params {string} "force" if added from disk
// @params {integer} position of previous good longest chain block
//
Blockchain.prototype.addBlockToBlockchainFailure = function addBlockToBlockchainFailure(newblock, pos, i_am_the_longest_chain, forceAdd) {

console.log(" ... blockchain failure");

  // restore longest chain
  this.index.lc[this.longestChain] = 0;
  this.lc_hashmap[newblock.returnHash()] = 0;
  this.longestChain = this.old_lc;

  // reset miner
  this.app.miner.stopMining();
  var latestBlk = this.returnLatestBlock();
  if (latestBlk != null) { this.app.miner.startMining(latestBlk); }

  // update blockchain info
  this.updateForkId(this.returnLatestBlock());
  this.app.options.blockchain = this.returnBlockchain();
  this.app.storage.saveOptions();

  // remove bad everything
  this.app.mempool.removeBlockAndTransactions(newblock);

  // empty recovered array because we are not 
  // removing anything after all...
  this.app.mempool.recovered = [];

  // allow indexing to continue
  newblock.app.blockchain.currently_indexing = 0;
  newblock.app.blockchain.app.mempool.processing_bundle = 0;

  console.log("values reset....\n\n");

}


/////////////////////////////////
// addBlockToBlockchainPartTwo //
/////////////////////////////////
//
// this function is called when the longest chain has been validated. now
// we save the block to disk and perform the second step of updating our
// wallet, invoking callbacks, etc.
//
// @params {saito.block} block
// @params {integer} position of block in indexes
// @params {integer} is block in longest chain
// @params {string} "force" if added from disk
//
Blockchain.prototype.addBlockToBlockchainPartTwo = function addBlockToBlockchainPartTwo(newblock, pos, i_am_the_longest_chain, forceAdd) {

console.log(" ... blockchain pt 2");

  var blockchain_self = this;

  ////////////////
  // save block //
  ////////////////
  this.app.storage.saveBlock(newblock, i_am_the_longest_chain);


  ////////////////
  // lc hashmap //
  ////////////////
  //
  // we use the hashmap to find the longest chain
  // in PartOne, so defer setting it to the longest
  // chain until we know we should.
  //
  this.lc_hashmap[newblock.returnHash()] = i_am_the_longest_chain;


  /////////////////////////////////
  // force a reset of our wallet //
  /////////////////////////////////
  //
  // if we are rebuilding from disk, our options
  // file will have outdated slip information, and
  // we should purge anything that is from this
  // block and block hash
  //
  // this should not be necessary, but helps with block
  // debugging during manual forced chain resets
  if (forceAdd == "force") {
    blockchain_self.app.wallet.purgeExistingBlockSlips(newblock);
  }


  var tmpgt2 = new Date().getTime();
  console.log(" ... updating wallet1: " + tmpgt2);


  ///////////////////
  // update wallet //
  ///////////////////
  var updated_wallet = 0;
  blockchain_self.app.wallet.purgeExpiredSlips();

  for (let ti = 0; ti < newblock.transactions.length; ti++) {
    var tx = newblock.transactions[ti];
    if (tx.isFrom(blockchain_self.app.wallet.returnPublicKey()) || tx.isTo(blockchain_self.app.wallet.returnPublicKey())) {
      updated_wallet = 1;
      blockchain_self.app.wallet.paymentConfirmation(newblock, tx, i_am_the_longest_chain);
    }
  }
  if (updated_wallet == 1) {
    if (i_am_the_longest_chain == 1) {
      blockchain_self.app.wallet.calculateBalance();
      blockchain_self.app.wallet.updateBalance();
    }
    blockchain_self.app.wallet.saveWallet();
    blockchain_self.app.storage.saveOptions();
  }
  blockchain_self.app.wallet.resetSpentInputs();



  var tmpgt3 = new Date().getTime();
  console.log(" ... updating wallet2: " + tmpgt3);



  ///////////////////
  // run callbacks //
  ///////////////////
  if (blockchain_self.run_callbacks == 1) {
    if (forceAdd != "force") {
      var our_longest_chain = blockchain_self.returnLongestChainIndex(blockchain_self.callback_limit);
      for (let i = 0; i < our_longest_chain.length && i < blockchain_self.callback_limit; i++) {

        //
        // we may want to shift this to a callback, so that
        // returnBlockByHash can load locally if it exists or
        // fetch from disk through the storage class if it doesn't
        //
	// we do not handle this through the callback method as we 
	// expect to keep all blocks needed for callbacks in memory
	// 
	// TODO
	//
	// adjust this code so that we can still run callbacks on 
	// blocks that are stored on disk.
	//
        var thisblk = blockchain_self.returnBlockByHash(this.index.hash[our_longest_chain[i]]);
        if (thisblk != null) {

	  //
	  // encoding issues can still screw us up
	  //
          try {
	    thisblk.runCallbacks(i);
          } catch (err) {
	    console.log(JSON.stringify(err));
	  }
	  blockchain_self.app.storage.saveConfirmation(thisblk.returnHash(), i);
        } else {
  	  // ? error finding block ?
          console.log("ERROR: we do not have a block within our callback limit in run callbacks in blockchain");
	  process.exit();
        }
      }
    } else {

      //
      // we are forcing blocks in without callbacks, but we still
      // update their confirmation numbers.
      //
      var our_longest_chain = blockchain_self.returnLongestChainIndex(blockchain_self.callback_limit);

      for (let i = 0; i < our_longest_chain.length; i++) {
        let thisblk = blockchain_self.returnBlockByHash(blockchain_self.index.hash[our_longest_chain[i]]);
        thisblk.updateConfirmationNumberWithoutCallbacks(i);
      }
    }
  }



  //////////////////
  // confirm save //
  //////////////////
  //
  // the storage class can still be writing our block to disk, so
  // we start a timer to check when we are ready to continue. we
  // need to do this as subsequent / final steps in adding blocks
  // requires our local file to exist to avoid edge case errors.
  //

  console.log(" ... hitting timer1:   " + new Date().getTime());

  if (blockchain_self.app.storage.saving_blocks == 1) {
    blockchain_self.block_saving_timer = setInterval(function() {
      if (blockchain_self.app.storage.saving_blocks == 0) {
        blockchain_self.addBlockToBlockchainSuccess(newblock, pos, i_am_the_longest_chain, forceAdd);
      }
    }, this.block_saving_timer_speed);
  } else {
    blockchain_self.addBlockToBlockchainSuccess(newblock, pos, i_am_the_longest_chain, forceAdd);
  }

}


/////////////////////////////////
// addBlockToBlockchainSuccess //
/////////////////////////////////
//
// this concludes adding a block to our blockchain, handles deletions and
// any other functions that may require the block to have already been
// saved to disk. finally, it resets our variables to permit the next
// block to be processed.
//
// @params {saito.block} block
// @params {integer} position of block in indexes
// @params {integer} is block in longest chain
// @params {string} "force" if added from disk
//
Blockchain.prototype.addBlockToBlockchainSuccess = function addBlockToBlockchainSuccess(newblock, pos, i_am_the_longest_chain, forceAdd) {

console.log(" ... blockchain success");

  var blockchain_self = this;

  /////////////////////////
  // delete transactions //
  /////////////////////////
  //
  // we delete transaction data once blocks are old enough that
  // we no longer need their data for callbacks.
  //
  // note that block propagation to lite nodes fails if the callback
  // limit is too short and we don't have the block data actively
  // stored in memory.
  //
  if (blockchain_self.blocks.length > blockchain_self.callback_limit) {
    var blk2clear = blockchain_self.blocks.length - blockchain_self.callback_limit-1;
    if (blk2clear >= 0) {
      blockchain_self.blocks[blk2clear].transactions = [];
      blockchain_self.blocks[blk2clear].block.transactions = [];
      // sanity check for blocks added earlier
      if (pos < blk2clear) {
        blockchain_self.blocks[pos].transactions = [];
        blockchain_self.blocks[pos].block.transactions = [];
      }
    }
  }

  //
  // even if we are still running callbacks, we
  // don't need the JSON copies, just the objs
  //
  blockchain_self.blocks[pos].block.transactions = [];


  /////////////////////
  // clear the timer //
  /////////////////////
  clearInterval(blockchain_self.block_saving_timer);


  ///////////////////////////////
  // process any recovered txs //
  ///////////////////////////////
  //
  // in storage.js we push any transactions from blocks we
  // created that are being undone back into the mempool 
  // which is why we put it here -- we need to validate them
  // again.
  // 
  blockchain_self.app.mempool.reinsertRecoveredTransactions();


  /////////////////////
  // module callback //
  /////////////////////
console.log(" ... on new block");
  if (forceAdd != "force") { blockchain_self.app.modules.onNewBlock(newblock); }


  /////////////////////////
  // reset miner (again) //
  /////////////////////////
  //
  // if we find a solution too fast spammer module can hang
  //
  blockchain_self.app.miner.stopMining();
  var latestBlk = this.returnLatestBlock();
  if (latestBlk != null) { blockchain_self.app.miner.startMining(latestBlk); }



  ////////////////////
  // ok to continue //
  ////////////////////
  blockchain_self.app.mempool.currently_processing = 0;
  blockchain_self.currently_indexing = 0;

}


//////////////////
// binaryInsert //
//////////////////
//
// utility function used to add items to our fast indexes
//
Blockchain.prototype.binaryInsert = function binaryInsert(list, item, compare, search) {

  var start = 0;
  var end = list.length;

  while (start < end) {

    var pos = (start + end) >> 1;
    var cmp = compare(item, list[pos]);

    if (cmp === 0) {
      start = pos;
      end = pos;
      break;
    } else if (cmp < 0) {
      end = pos;
    } else {
      start = pos + 1;
    }
  }

  if (!search) { list.splice(start, 0, item); }

  return start;
}


/////////////////
// importBlock //
/////////////////
//
// the import block function expects to be provided with
// a JSON object that can be imported. It recreates the
// block object and then submits it to
//
//   validateBlockAndQueueInMempool
//
// @params {string} json of block
// @params {integer} relay block after validating
//
Blockchain.prototype.importBlock = function importBlock(blkjson, expected_block_hash="", relay_on_validate=1) {
  var nb = new saito.block(this.app, blkjson);
  //
  // lite-clients may receive lite-blocks without the full
  //
  if (expected_block_hash == "") { return; }
  if (nb == null) { return; }
  if (nb.is_valid == 0) { return; }
  if (this.app.BROWSER == 0 && expected_block_hash != nb.returnHash()) { return; }
  nb.size = blkjson.length;
  this.validateBlockAndQueueInMempool(nb, relay_on_validate);
}


//////////////////////
// isBlockIdIndexed //
//////////////////////
//
// @params {integer} block_id
// @returns {boolean} is block_id indexed?
//
Blockchain.prototype.isBlockIdIndexed = function isBlockIdIndexed(block_id) {
  for (let n = this.index.block_id.length-1; n >= 0; n--) {
    if (this.index.block_id[n] == block_id) {
      return 1;
    }
    if (this.index.block_id[n] < block_id) {
      return -1;
    }
  }
  return -1;
};


///////////////////
// isHashIndexed //
///////////////////
//
// checks if a block with this hash is in our index
//
// @params {string} block hash
// @returns {boolean} is hash in index?
//
Blockchain.prototype.isHashIndexed = function isHashIndexed(hash) {
  if (this.block_hashmap[hash] > 0) { return 1; }
  return -1;
};


///////////////////////
// purgeArchivedData //
///////////////////////
//
// this is called whenever we add a block to our blockchain. it
// calculates how many blocks we can discard and dumps them.
//
// @params {integer} id of lowest block to keep
// @params {integer} position of lowest block in index
// @returns {integer} new position of lowest block in index
//
Blockchain.prototype.purgeArchivedData = function purgeArchivedData(lowest_block_id, pos) {

  let items_before_needed = 0;

  //
  // find the number of items in our blockchain before
  // we run into the lowest_block_id. Remember that blocks
  // are going to be sequential so it is only forks that
  // we really worry about
  //
  for (let x = 0; x < this.index.block_id.length; x++) {
    if (this.index.block_id[x] < lowest_block_id) {
      items_before_needed++;
    }
    else { x = this.blocks.length; }
  }


  //////////////////////////////
  // delete transaction slips //
  //////////////////////////////
  //
  // also deletes the block file once done
  //
  for (let b = 0; b < items_before_needed; b++) {
    this.app.storage.purgeBlockStorage(this.index.hash[b]);
  }


  /////////////////////////
  // delete from hashmap //
  /////////////////////////
  for (let x = 0; x < items_before_needed; x++) {

    let bh = this.index.hash[x];

    //
    // this is why we cannot
    // 'use strict' in this
    // class
    //
    delete this.block_hashmap[bh];
    delete this.lc_hashmap[bh];
  }


  ////////////////////////////////////////////////
  // delete from fast-access indexes and blocks //
  ////////////////////////////////////////////////
  this.index.hash.splice(0, items_before_needed);
  this.index.ts.splice(0, items_before_needed);
  this.index.prevhash.splice(0, items_before_needed);
  this.index.burnfee.splice(0, items_before_needed);
  this.index.block_id.splice(0, items_before_needed);
  this.index.mintid.splice(0, items_before_needed);
  this.index.maxtid.splice(0, items_before_needed);
  this.index.lc.splice(0, items_before_needed);
  this.blocks.splice(0, items_before_needed);

  var newpos = pos - items_before_needed;

  //////////////////
  // and clean up //
  //////////////////
  this.longestChain = this.longestChain - items_before_needed;
  this.app.wallet.purgeExpiredSlips();

  //
  // deletes database
  //
  this.app.storage.deleteBlocks(lowest_block_id);

  return newpos;

}


/////////////////////////////
// returnLastSharedBlockId //
/////////////////////////////
//
// used by the peer class to help nodes identify their last
// shared ancestor block, in order to give them the full chain
// from that point.
//
// @params {string} saito fork_id
// @params {integer} last known block_id
// @returns {integer} last shared block_id
//
Blockchain.prototype.returnLastSharedBlockId = function returnLastSharedBlockId(fork_id, latest_known_block_id) {

  // if there is no fork_id submitted, we backpedal 1 block to be safe
  if (fork_id == null || fork_id == "") { return 0; }
  if (fork_id.length < 2) { if (latest_known_block_id > 0) { latest_known_block_id - 1; } else { return 0; } }

  // roll back latest known block id to known fork ID measurement point
  for (let x = latest_known_block_id; x >= 0; x--) {
    if (x%this.fork_id_mod == 0) {
      latest_known_block_id = x;
      x = -1;
    }
  }

  // roll back until we have a match
  for (let fii = 0; fii < (fork_id.length/2); fii++) {

    var peer_fork_id_pair = fork_id.substring((2*fii),2);
    var our_fork_id_pair_blockid = latest_known_block_id;

    if (fii == 0)  { our_fork_id_pair_blockid = latest_known_block_id - 0; }
    if (fii == 1)  { our_fork_id_pair_blockid = latest_known_block_id - 10; }
    if (fii == 2)  { our_fork_id_pair_blockid = latest_known_block_id - 20; }
    if (fii == 3)  { our_fork_id_pair_blockid = latest_known_block_id - 30; }
    if (fii == 4)  { our_fork_id_pair_blockid = latest_known_block_id - 40; }
    if (fii == 5)  { our_fork_id_pair_blockid = latest_known_block_id - 50; }
    if (fii == 6)  { our_fork_id_pair_blockid = latest_known_block_id - 75; }
    if (fii == 7)  { our_fork_id_pair_blockid = latest_known_block_id - 100; }
    if (fii == 8)  { our_fork_id_pair_blockid = latest_known_block_id - 200; }
    if (fii == 9)  { our_fork_id_pair_blockid = latest_known_block_id - 500; }
    if (fii == 10) { our_fork_id_pair_blockid = latest_known_block_id - 1000; }
    if (fii == 11) { our_fork_id_pair_blockid = latest_known_block_id - 5000; }
    if (fii == 12) { our_fork_id_pair_blockid = latest_known_block_id - 10000; }
    if (fii == 13) { our_fork_id_pair_blockid = latest_known_block_id - 50000; }

    // return hash by blockid
    var tmpklr = this.returnHashByBlockIdLongestChain(our_fork_id_pair_blockid);

    // if we have not found a match, return 0 since we have
    // irreconciliable forks, so we just give them everything
    // in the expectation that one of our forks will eventually
    // become the longest chain
    if (tmpklr == "") { return 0; }

    var our_fork_id_pair = tmpklr.substring(0, 2);

    // if we have a match in fork ID at a position, treat this
    // as the shared forkID
    if (our_fork_id_pair == peer_fork_id_pair) {
      return our_fork_id_pair_blockid;
    }

  }
  return 0;
}


/////////////////////////////////////
// returnHashByBlockIdLongestChain //
/////////////////////////////////////
//
// given a block ID, it returns the hash of the block
// that has that ID and is on the longest chain.
//
// @params {integer} block id
// @returns {string} hash of block
//
Blockchain.prototype.returnHashByBlockIdLongestChain = function returnHashByBlockIdLongestChain(block_id) {
  for (let n = this.index.block_id.length-1; n >= 0; n--) {
    if (this.index.block_id[n] == block_id && this.index.lc[n] == 1) {
      return this.index.hash[n];
    }
    if (this.index.block_id[n] < block_id) {
      return "";
    }

    //
    // TODO - otimize
    //
    // faster than iterating through, but not optimized
    //
    if (n-50 >= 1) {
      if (this.index.block_id[n-50] > block_id) {
        n-=50;
      }
    }
  }
  return "";
}


///////////////////
// returnMinTxId //
///////////////////
//
// used by block class
//
// @returns {integer} lowest tx_id in blockchain
//
Blockchain.prototype.returnMinTxId = function returnMinTxId() {
  if (this.longestChain == -1) { return 0; }
  return this.index.mintid[this.longestChain];
}


///////////////////
// returnMinTxId //
///////////////////
//
// used by block class
//
// @returns {integer} lowest tx_id in blockchain
//
Blockchain.prototype.returnMaxTxId = function returnMaxTxId() {
  if (this.longestChain == -1) { return 0; }
  return this.index.maxtid[this.longestChain];
}


////////////////////
// returnUnixtime //
////////////////////
//
// given a hash return the unixtime associated with the block
// that produced the hash, or -1
//
// @params {string} block hash
// @returns {integer} timestamp on success
// @returns {integer} -1 on failure
//
Blockchain.prototype.returnUnixtime = function returnUnixtime(blockhash) {
  //
  // TODO
  //
  // should not search such a length period
  //
  // fix -- check ID from hashmap and search for block that way
  //
  if (blockhash == "") { return -1; }
  for (let i = this.index.hash.length-1; i >= 0 && i > this.index.hash.length-1000; i--) {
    if (this.index.hash[i] == blockhash) {
        return this.index.ts[i];
    }
  }
  return -1;
}


/////////////////////////////
// returnLongestChainIndex //
/////////////////////////////
//
// returns an array with the index positions of the blocks
// in our indexes that form the longest chain. the chainlength
// variable controls how deep the function searches
//
// @params {integer} how deep to search
// @returns {array} of integers/index positions
//
Blockchain.prototype.returnLongestChainIndex = function returnLongestChainIndex(chainlength=10) {
  if (this.index.hash.length == 0) { return []; }
  if (this.index.hash.length < chainlength) { chainlength = this.index.hash.length; }
  if (chainlength == 0) { return []; }

  var bchainIndex = [];
  var chain_pos = this.longestChain;

  bchainIndex.push(chain_pos);

  for (let z = 0; z < chainlength; z++) {

    var prev_pos = chain_pos-1;
    var prev_found = 0;

    if (prev_pos == -1) {
      z = chainlength+1;
    } else {

      // get the previous block
      while (prev_pos >= 0 && prev_found == 0) {
        if (this.index.hash[prev_pos] == this.index.prevhash[chain_pos]) {
          bchainIndex.push(prev_pos);
          prev_found = 1;
          chain_pos = prev_pos;
        } else {
          prev_pos--;
        }
      }
    }
  }
  return bchainIndex;
}


//////////////////////////////////////////////
// returnLongestChainIndexPositionByBlockId //
//////////////////////////////////////////////
//
// returns an array with the index positions of the blocks
// in our indexes that form the longest chain, stretching
// back until the block_id provided
//
// @params {integer} block_id to find
// @params {integer} tarting index position
// @returns {array} of integers/index positions
//
Blockchain.prototype.returnLongestChainIndexPositionByBlockId = function returnLongestChainIndexPositionByBlockId(blkid, spos=-1) {
  if (this.index.hash.length == 0) { return null; }
  var start_pos = this.index.hash.length-1;
  if (spos != -1) { start_pos = spos; }
  for (let c = start_pos; c >= 0; c--) {
    if (this.index.block_id[c] == blkid) {
      if (this.index.lc[c] == 1) {
	return c;
      }
    }
  }
  return -1;
}


///////////////////////
// returnLatestBlock //
///////////////////////
//
// returns block obj of latest block
//
// @returns {saito.block}
//
Blockchain.prototype.returnLatestBlock = function returnLatestBlock() {
  if (this.blocks.length == 0) { return null; }
  for (let i = this.blocks.length-1; i >= 0; i--) {
    if (this.blocks[i].hash == this.index.hash[this.longestChain]) {
      return this.blocks[i];
    }
  }
  return null;
}


///////////////////////////////
// returnLatestBlockUnixtime //
///////////////////////////////
//
// @returns {integer} timestamp
//
Blockchain.prototype.returnLatestBlockUnixtime = function returnLatestBlockUnixtime() {
  if (this.blocks.length == 0) { return -1; }
  if (this.blocks.length < this.longestChain) { return -1; }
  return this.index.ts[this.longestChain];
}


///////////////////////////
// returnLatestBlockHash //
///////////////////////////
//
// @returns {string} block hash
//
Blockchain.prototype.returnLatestBlockHash = function returnLatestBlockHash() {
  if (this.blocks.length == 0) { return ""; }
  if (this.blocks.length < this.longestChain) { return ""; }
  return this.index.hash[this.longestChain];
}


///////////////////////
// returnLatestBlock //
///////////////////////
//
// @returns {integer} block_id
//
Blockchain.prototype.returnLatestBlockId = function returnLatestBlockId() {
  if (this.index.block_id.length == 0) { return 0; }
  return this.index.block_id[this.longestChain];
}


///////////////////////
// returnLatestBlock //
///////////////////////
//
// @returns {saito.block} block
//
Blockchain.prototype.returnBlockByHash = function returnBlockByHash(hash, mycallback=null) {

  //
  // first check our in-memory blocks
  //
  for (let v = this.blocks.length-1; v >= 0; v-- ) {
    if (this.blocks[v].hash == hash) {
      if (mycallback == null) {
        return this.blocks[v];
      } else {
        mycallback(this.blocks[v]);
	return;
      }
    }
  }

  //
  // first check our in-memory blocks
  //
  if (this.app.BROWSER == 0 && this.app.SPVMODE == 0) {
    if (mycallback != null) {
      this.app.storage.openBlockByHash(hash, function(storage_self, blk) {
        mycallback(blk);
	return;
      });
      return;
    }
  }


  if (mycallback == null) {
    return null;
  } else {
    mycallback(null);
    return;
  }
}


/////////////////////////////////
// returnBlockByIdLongestChain //
/////////////////////////////////
Blockchain.prototype.returnBlockByIdLongestChain = function returnBlockByIdLongestChain(id=0) {
  if (this.index.hash.length == 0) { return null; }
  if (id == 0) { return null; }
  for (var bi = this.index.block_id.length-1; bi >= 0; bi--) {
    if (this.index.block_id[bi] == id && this.index.lc[bi] == 1) {
      return this.blocks[bi];
    }
  }
}


//////////////////
// returnForkId //
//////////////////
//
// @returns {string} fork_id
//
Blockchain.prototype.returnForkId = function returnForkId() {
  return this.fork_id;
}


//////////////////////////
// returnGenesisBlockId //
//////////////////////////
//
// @returns {integer} genesis block id
//
Blockchain.prototype.returnGenesisBlockId = function returnGenesisBlockId() {
  return this.genesis_block_id;
}


/////////////////////////
// returnGenesisPeriod //
/////////////////////////
//
// returns block obj of latest block
//
// @returns {saito.block}
//
Blockchain.prototype.returnGenesisPeriod = function returnGenesisPeriod() {
  return this.genesis_period;
}


//////////////////////
// returnBlockchain //
//////////////////////
//
// this is what gets stored in the options file and
// lets us start up the sync again.
//
// @returns {js object}
//
Blockchain.prototype.returnBlockchain = function returnBlockchain() {
  var x = {};
  x.latest_block_ts    = this.returnLatestBlockUnixtime();
  x.latest_block_hash  = this.returnLatestBlockHash();
  x.latest_block_id    = this.returnLatestBlockId();
  x.genesis_block_id   = this.returnGenesisBlockId();
  x.fork_id            = this.fork_id;
  return x;
}


//////////////////
// updateForkId //
//////////////////
//
// @params {saito.block} new block
//
Blockchain.prototype.updateForkId = function updateForkId(blk) {

  if (blk == null) { return this.fork_id; }

  let blockid     = blk.returnId();
  let baseblockid = blockid;
  let fork_id     = "";
  let indexpos    = this.index.hash.length-1;

  for (let i = 0, stop = 0; stop == 0 && i < this.genesis_period;) {

    let checkpointblkid = baseblockid-i;
    indexpos = this.returnLongestChainIndexPositionByBlockId(checkpointblkid, indexpos);

    if (indexpos == -1 || checkpointblkid < 0) { stop = 1; }
    else {
      // get the hash
      let th = this.index.hash[indexpos];
      fork_id += th.substring(0,2);
    }

    // if this is edited, we have to
    // also change the function
    //
    // - returnLastSharedBlockId
    //
    if (i == 10000) { i = 50000; }
    if (i == 5000)  { i = 10000; }
    if (i == 1000)  { i = 5000; }
    if (i == 500)   { i = 1000; }
    if (i == 200)   { i = 500; }
    if (i == 100)   { i = 200; }
    if (i == 75)    { i = 100; }
    if (i == 50)    { i = 75; }
    if (i == 40)    { i = 50; }
    if (i == 30)    { i = 40; }
    if (i == 20)    { i = 30; }
    if (i == 10)    { i = 20; }
    if (i == 0)     { i = 10; }

    if (i > this.genesis_period || i == 50000) { stop = 1; }

  }

  this.fork_id = fork_id;

}


////////////////////////
// updateGenesisBlock //
////////////////////////
//
// when the blockchain hits a certain length we throw out all of our older blks
// this is possible because block ids are incremental. We do check our last fork_guard
// blocks to make sure there is not a block that might reference one of the
// blocks we are throwing out before we purge ourselves of them.
//
// @params {saito.block} block
// @params {integer} position in index
//
Blockchain.prototype.updateGenesisBlock = function updateGenesisBlock(blk, pos) {

  //
  // we need to make sure this is not a random block that is disconnected
  // from our previous genesis_id. If there is no connection between it
  // and us, then we cannot delete anything as otherwise the provision of
  // the block may be an attack on us intended to force us to discard
  // actually useful data.
  //
  // we do this by checking that our block is the head of the
  // verified longest chain.
  //
  if (this.index.hash[this.longestChain] != blk.returnHash('hex')) {
    return pos;
  }
  if (this.index.hash.length < this.genesis_period) {
    return pos;
  }

  if (blk.returnId() >= (this.genesis_block_id + this.genesis_period + this.fork_guard)) {

    //
    // check the fork guard period to see if there is a viable
    // competing chain. If there is we must assume there may be
    // a viable competing chain to preserve
    //
    var is_there_a_challenger = 0;
    var our_block_id    = blk.returnId();

    //
    // -1 accounts for the fact we reclaim the funds from unspent
    // golden tickets, and need to know for sure that those slips
    // have not been spent when we calculate getting them back
    // into circulation. So we keep an extra block on the tail
    // end, even if it is unspendable, for validation
    //
    var lowest_block_id = our_block_id - this.genesis_period - 1;

    //
    // do not delete if our new genesis block would be less than zero
    //
    if (lowest_block_id <= 0) { return; }

    //
    // otherwise, figure out what the lowest block ID is that would
    // be possible to grow into a viable fork. We do this by looking
    // at our recently produced blocks. The fork guard here is an
    // arbitrary constant.
    //
    for (let c = 2; c <= this.fork_guard && c < this.index.block_id.length; c++) {
      if (this.index.block_id[this.index.block_id.length-c] < lowest_block_id) {
        lowest_block_id = this.index.block_id[this.index.block_id.length-2];
      }
    }

    //
    // this is needed before update genesis_block_id to ensure
    // wallet slips are updated properly (they are updated in
    // purgeArchivedData but require a new genesis_period to
    // calculate, so much udpate genesis_period and THEN purge,
    // meaning this calculation must be stored
    //
    var purge_id = lowest_block_id - this.genesis_period;

    //
    // finally, update our genesis block_id to the current_block minus
    // the genesis period. We will run this function again when the
    // fork guard has passed, and if any forks have not sufficiently
    // kept pace in that time, they will be discarded them.
    //
    this.genesis_block_id = blk.returnId() - this.genesis_period;

    //
    // in either case, we are OK to throw out everything below the
    // lowest_block_id that we have found, since even the lowest
    // fork in our guard_period will not need to access transactions
    // from before itself and the genesis period.
    //
    // we use the purge_id variable since our functions inside
    // need to delete from wallet slips, which requires genesis
    // block_id to be set properly.
    //
    return this.purgeArchivedData(purge_id, pos);

  }

  return pos;
}
