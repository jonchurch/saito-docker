'use strict';

const saito = require('../saito');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');


/////////////////
// Constructor //
/////////////////
function Mempool(app) {

  if (!(this instanceof Mempool)) {
    return new Mempool(app);
  }

  this.app                        = app || {};

  this.data_directory             = path.join(__dirname, '../data/');

  this.transactions               = []; // array
  this.blocks                     = []; // queue fifo

  this.currently_processing       = 0;
  this.processing_timer           = null;
  this.processing_speed           = 300; // 0.3 seconds (add blocks)

  this.currently_bundling         = 0;
  this.bundling_timer             = null;
  this.bundling_speed             = 400; // 0.4 seconds

  this.currently_clearing         = 0;   // 1 when clearing blks + txs
  this.currently_creating         = 0;   // 1 when creating a block from our txs
  this.bundling_fees_needed       = -1;


  this.load_time                  = new Date().getTime();
  this.load_delay                 = 4000; // delay on startup so we have time
					  // to start reading from disk before
					  // we leap into block creation.


  if (this.bundling_speed < this.processing_speed) { this.bundling_speed = this.processing_speed+100; }

  return this;

}
module.exports = Mempool;


////////////////
// initialize //
////////////////
//
// start the loop to try and bundle blocks
//
Mempool.prototype.initialize = function initialize() {

  var mempool_self = this;

  if (mempool_self.app.BROWSER == 0 || mempool_self.app.SPVMODE == 0) {

    // use a timeout to get network class a 
    // bit of time to initialize. otherwise
    // we can have problems with calls to 
    // returnNumberOfPeers() etc.
    setTimeout(function() {
      mempool_self.startBundling();
    }, 1000);
  }

}


//////////////
// addBlock //
//////////////
//
// add block to mempool queue if it does not already exist
//
// n.b. if JSON use importBlock
//
// @returns {boolean} is successful?
//
Mempool.prototype.addBlock = function addBlock(blk) {
  if (blk == null) { return 0; }
  if (blk.is_valid == 0) { return 0; }
  for (let i = 0; i < this.blocks.length; i++) {
    if (this.blocks[i].returnHash() == blk.returnHash()) { return 0; }
  }
  this.blocks.push(blk);
  return 1;
}


////////////////////
// addTransaction //
////////////////////
//
// add transaction to mempool array if it does not already exist
//
// n.b. if JSON use importTransaction
//
Mempool.prototype.addTransaction = function addTransaction(tx, relay_on_validate=1) {

  let transaction_imported = 0;

  //
  // avoid adding if there is an obvious problem
  //
  if (this.containsTransaction(tx) == 1) { return; }
  if (tx == null)                        { return; }
  if (tx.transaction == null)            { return; }
  if (tx.is_valid == 0) 		 { return; }

  //
  // only accept one golden ticket
  //
  if (tx.transaction.gt != null) {
    for (let z = 0; z < this.transactions.length; z++) {
      if (this.transactions[z].transaction.gt != null) {

	//
	// ensure golden ticket is for the latest block
	//
        if (this.transactions[z].transaction.gt.target == this.app.blockchain.returnLatestBlockHash()) {

	  //
	  // if we already have a golden ticket solution, we will
	  // replace it with this new one if the new one pays us 
	  // more in fees and/or is going to pay us money.
	  //
          if (
   	    tx.returnFeeUsable() > this.transactions[z].returnFeeUsable() || (
	      this.transactions[z].transaction.from[0].add != this.app.wallet.returnPublicKey() && 
	      tx.transaction.from[0].add == this.app.wallet.returnPublicKey()
	    )
	  ) {
            this.transactions[z] = tx;
            transaction_imported = 1;
            z = this.transactions.length+1;
          } else {
            transaction_imported = 1;
          }
        } else {
          this.removeGoldenTicket();
        }
      }
    }
  }

  if (transaction_imported == 0) {
    var mempool_self = this;
    this.app.storage.validateTransactionInputsForMempool(tx, function(app, tx) {
      if (relay_on_validate == 1) {

	//
        // propagate if we can't use tx to create a block
	//
        if ( mempool_self.bundling_fees_needed > tx.returnFeeUsable() ) {

	  //
	  // add to mempool before propagating
	  // as propagateTransaction will check
	  //
          mempool_self.transactions.push(tx);
          mempool_self.app.network.propagateTransaction(tx);
	  return;
        }
      }
      mempool_self.transactions.push(tx);
    });
  }
}


/////////////////
// bundleBlock //
/////////////////
//
// we believe we have enough fees to produce a block, so we 
// set the paysplit vote and bundle in the transactions we
// can, then submit the block to the block class to finalize.
//
// @params {saito.block} previous block
//
Mempool.prototype.bundleBlock = function bundleBlock(prevblk) {

  //
  // creating a block requires DB access for things
  // like figuring out the reclaimed fees. this can
  // cause bad blocks to pile up in the creation process
  // at large data blocks, so we check to make sure
  // we are not already in the process of bundling
  // one before we try again....
  //
  if (this.currently_creating == 1) { return; }
  this.currently_creating = 1;

  //
  // create the block
  //
  var nb = new saito.block(this.app);
  if (nb == null || nb.is_valid == 0) {
    this.currently_creating = 0;
    return;
  }

  //
  // set the paysplit vote
  //
  nb.block.paysplit_vote = this.app.voter.returnPaysplitVote(prevblk.block.paysplit);


  //
  // add mempool transactions
  //
  for (let i = 0; i < this.transactions.length; i++) {
    let addtx = 1;
    if (this.transactions[i].transaction.gt != null) { 

      //
      // this will happen if we run into a Golden Ticket for an older
      // block. we do not want to include this as it will make our
      // block invalid.
      //
      // this GT will be removed from our mempool automatically the 
      // next time we receive a golden ticket from someone else.
      //
      if (this.transactions[i].transaction.gt.target != prevblk.returnHash()) { 
        addtx = 0; 
      } 
    }
    if (nb.paysplit_vote == -1) {
      if (this.transactions[i].transaction.ps == 1) { 
	addtx = 0;
      }
    }
    if (nb.paysplit_vote == 1) {
      if (this.transactions[i].transaction.ps == -1) { 
	addtx = 0;
      }
    }
    if (addtx == 1) { 
      nb.addTransaction(this.transactions[i]); 
    }
  }

  //
  // add fee-capture transaction
  //
  let my_fees    = nb.returnSurplusFees();
  if (my_fees == null) { my_fees = 0.0; }
  if (my_fees > 0) {
    var tx2 = this.app.wallet.createFeeTransaction(my_fees);
    nb.addTransaction(tx2);
  }

  nb.bundleBlock(prevblk);
  return;

}


//////////////////
// clearMempool //
//////////////////
//
// remove block and its transactions from mempool
//
// @params {saito.block} block to delete
//
Mempool.prototype.clearMempool = function clearMempool(blk) {
  if (blk == null) { return; }
  this.currently_clearing = 1;
  for (let bt = blk.transactions.length-1; bt >= 0; bt--) {
    this.removeTransaction(blk.transactions[bt]);
  }
  this.removeBlock(blk);
  this.currently_clearing = 0;
}


//////////////////////////
// containsGoldenTicket //
//////////////////////////
//
// return 1 if mempool already contains this transaction
//
// @params {saito.transaction} transaction to check
// @returns {boolean} is transaction in mempool?
//
Mempool.prototype.containsGoldenTicket = function containsGoldenTicket() {
  for (let m = 0; m < this.transactions.length; m++) {
    if (this.transactions[m].isGoldenTicket() == 1) { return 1; }
  }
  return 0;
}


/////////////////////////
// containsTransaction //
/////////////////////////
//
// return 1 if mempool already contains this transaction
//
// @params {saito.transaction} transaction to check
// @returns {boolean} is transaction in mempool?
//
Mempool.prototype.containsTransaction = function containsTransaction(tx) {

  if (tx == null)             { return 0; }
  if (tx.transaction == null) { return 0; }

  //
  // TODO
  //
  // if we insert the transactions into the array based on their sig
  // data we can optimize searching through the mempool once it is 
  // sizeable. another option might be using a hashmap to search.
  //
  // we check by looking for the signature of the transaction, as that
  // will be unique to each transaction and not influenced by the path
  // it has travelled to us from.
  //
  for (let mtp = 0; mtp < this.transactions.length; mtp++) {
    if (this.transactions[mtp].transaction.sig == tx.transaction.sig) {
      return 1;
    }
  }
  return 0;
}


/////////////////
// importBlock //
/////////////////
//
// create block from json and add to mempool
//
// @params {string} block as json
// @returns {boolean} successful ?
//
Mempool.prototype.importBlock = function importBlock(blkjson) {
  var blk = new saito.block(this.app, blkjson);
  if (blk == null) { return 0; }
  if (blk.is_valid == 0) { return 0; }
  return this.addBlock(blk);
}


///////////////////////
// importTransaction //
///////////////////////
//
// create transaction from json and add to mempool
//
// @params {string} transaction as json
//
Mempool.prototype.importTransaction = function importTransaction(txjson) {
  var tx = new saito.transaction(txjson);
  if (tx == null) { return; }
  if (tx.is_valid == 0) { return; }
  this.addTransaction(tx);
}


///////////////////
// processBlocks //
///////////////////
//
// if there are any blocks in our mempool, we try to add
// them to the blockchain one-by-one.
//
Mempool.prototype.processBlocks = function processBlocks() {

  if (this.currently_processing == 1) { 
    console.log("Mempool processing.... not adding new block to blockchain");
    return; 
  }

  if (this.blocks.length == 0) {
    console.log("Mempool processing.... no blocks to add to blockchain");
    this.currently_processing = 0;
    return;
  }

  var mempool_self = this;

  if (this.processing_timer == null) {
    this.processing_timer = setInterval(function() {

      if (mempool_self.currently_clearing == 1) { return; }

      if (mempool_self.currently_processing == 1) { return; }
      mempool_self.currently_blocks = 1;

      if (mempool_self.blocks.length == 0) {
        mempool_self.currently_processing = 0;
        return;
      }

      // FIFO adding from our queue
      var blk = mempool_self.returnBlock();
      if (blk == null) { 
	mempool_self.currently_processing = 0;
        return;
      }

      // add and delete block unless we get kickback
      if (blk != null) {
        var delete_blk_from_mempool = 0;
        if (blk.prevalidated == 0) {
          delete_blk_from_mempool = mempool_self.app.blockchain.addBlockToBlockchain(blk);
	} else {
          delete_blk_from_mempool = mempool_self.app.blockchain.addBlockToBlockchain(blk, "force");
	}
        if (delete_blk_from_mempool == 1) {
          mempool_self.clearMempool(blk);
        }
      }

      // if we have emptied our queue
      if (mempool_self.blocks.length == 0) {
        clearInterval(mempool_self.processing_timer);
        mempool_self.processing_timer = null;
      }

      mempool_self.currently_processing = 0;

    }, mempool_self.processing_speed);
  }
}


/////////////////
// removeBlock //
/////////////////
//
// remove block from mempool if exists
//
// @params {saito.block} block_to_remove
//
Mempool.prototype.removeBlock = function removeBlock(blk) {
  if (blk == null) { return; }
  for (let b = this.blocks.length-1; b >= 0; b--) {
    if (this.blocks[b].returnHash() == blk.returnHash()) {
      this.blocks.splice(b, 1);
    }
  }
}


////////////////////////////////
// removeBlockAndTransactions //
////////////////////////////////
//
// removes block and its transactions from mempool
//
// @params {saito.block} block
//
Mempool.prototype.removeBlockAndTransactions = function removeBlockAndTransactions(blk) {
  if (blk == null) { return; }
  for (let b = 0; b < blk.transactions.length; b++) {
    this.removeTransaction(blk.transactions[b]);
  }
  this.removeBlock(blk);
}


////////////////////////
// removeGoldenTicket //
////////////////////////
//
// removes Golden Ticket from mempool
//
Mempool.prototype.removeGoldenTicket = function removeGoldenTicket() {
  for (let i = this.transactions.length-1; i >= 0; i--) {
    if (this.transactions[i].transaction.gt != null) {
      this.removeTransaction(this.transactions[i]);
      return;
    }
  }
}


///////////////////////
// removeTransaction //
///////////////////////
//
// remove transaction from mempool if exists
//
// @params {saito.transaction} tx_to_remove
//
Mempool.prototype.removeTransaction = function removeTransaction(tx) {
  if (tx == null) { return; }
  for (let t = this.transactions.length-1; t >= 0; t--) {
    if (this.transactions[t].transaction.sig == tx.transaction.sig) {
      this.transactions.splice(t, 1);
    }
  }
}


/////////////////
// returnBlock //
/////////////////
//
// returns next block to process
//
// @returns {saito.block} block
//
Mempool.prototype.returnBlock = function returnBlock() {
  if (this.blocks.length == 0) { return null; }
  var tmpblk = this.blocks[0];
  return tmpblk;
}


//////////////////////////////
// returnBundlingFeesNeeded //
//////////////////////////////
//
// return fees needed to produce a block. used when
// checking if a new transaction pushes us over the edge
//
// @returns {decimal} bundling_fees_needed
//
Mempool.prototype.returnBundlingFeesNeeded = function returnBundlingFeesNeeded() {
  return this.bundling_fees_needed;
}


///////////////////////////////////////
// returnNormalTransactionsInMempool //
///////////////////////////////////////
//
// return total number of non golden-ticket transactions
// in the mempool.
//
// @returns {integer} num of txs
//
Mempool.prototype.returnNormalTransactionsInMempool = function returnNormalTransactionsInMempool() {
  var v = 0;
  for (let i = 0; i < this.transactions.length; i++) {
    if (this.transactions[i].transaction.gt == null) { v++; }
  }
  return v;
}


/////////////////////////////////
// returnUsableTransactionFees //
/////////////////////////////////
//
// returns the total value of the transaction fees in the 
// mempool that can be used to produce a block with a 
// certain paysplit vote.
//
// @params {integer} paysplit_vote
// returns {string} value;
//
Mempool.prototype.returnUsableTransactionFees = function returnUsableTransactionFees(paysplit_vote=0) {
  var v = 0;
  for (let i = 0; i < this.transactions.length; i++) {
    if (paysplit_vote == -1) {
      if (this.transactions[i].transaction.ps <= 0) {
        v += this.transactions[i].returnFeeUsable();
      }
    }
    if (paysplit_vote == 0) {
      v += this.transactions[i].returnFeeUsable();
    }
    if (paysplit_vote == 1) {
      if (this.transactions[i].transaction.ps >= 0) {
        v += this.transactions[i].returnFeeUsable();
      }
    }
  }
  return v.toFixed(8);
}


///////////////////
// startBundling //
///////////////////
//
// start our loop that attempts to bundle blocks
//
Mempool.prototype.startBundling = function startBundling() {

  if (this.currently_bundling == 1) { return; }

  var mempool_self = this;

  this.bundling_timer = setInterval(function() { mempool_self.tryToBundleBlock(); }, this.bundling_speed);

}


//////////////////
// stopBundling //
//////////////////
//
// stop trying to bundle blocks
//
Mempool.prototype.stopBundling = function stopBundling() {
  clearInterval(this.bundling_timer);
  this.currently_bundling = 0;
}


//////////////////////
// tryToBundleBlock //
//////////////////////
//
// bundling a block is the process of taking the transactions in 
// our mempool and putting them in a block that will validate. the
// first step in this process is checking to see if we have enough
// transactions to actually produce a valid block.
//
// if we do have enough transactions, we will create the block and
// then send it to the block class where it will be completed. the
// process for adding a block is basically:
//
//   Mempool    --> tryToBundleBlock
//   Mempool    --> bundleBlock
//   Block      --> createBlock
//   Mempool    --> addBlock
//   Mempool    --> processBlock
//   Blockchain --> addBlockToBlockchain
//
Mempool.prototype.tryToBundleBlock = function tryToBundleBlock() {

  var mempool_self = this;
  var block_paysplit_vote = 0;

  //
  // check we can bundle a block
  //
  if (mempool_self.app.monitor.readyToBundleBlock() == 1) {

    //
    // fetch the block we are building atop
    //
    var latestBlk = mempool_self.app.blockchain.returnLatestBlock();
    if (latestBlk == null) { 
      latestBlk = new saito.block(mempool_self.app); 
      latestBlk.block.id = 0; 
    } else {
      block_paysplit_vote = mempool_self.app.voter.returnPaysplitVote(latestBlk.block.paysplit);
    }

    //
    // calculate fees available
    //
    let fees_needed = 0;
    let fees_available = mempool_self.returnUsableTransactionFees(block_paysplit_vote);
    if (fees_available < 0) { fees_available = 0; }

    //
    // calculate fees needed
    //
    if (latestBlk != null) {
      let unixtime_original = mempool_self.app.blockchain.returnUnixtime(latestBlk.returnHash());
      let unixtime_current = new Date().getTime();
      let milliseconds_since_block = unixtime_current - unixtime_original;
      fees_needed = ( latestBlk.returnBurnFee() - (latestBlk.returnFeeStep() * milliseconds_since_block) );
      if (fees_needed < 0) { fees_needed = 0; }
    }

    mempool_self.bundling_fees_needed = fees_needed - fees_available;

    console.log((new Date()) + ": " + fees_needed.toFixed(8) + " ---- " + fees_available + " (" + mempool_self.transactions.length + "/"+mempool_self.returnNormalTransactionsInMempool()+" -- "+mempool_self.app.wallet.returnBalance()+")");

    //
    // can we bundle a block? 
    //
    if (mempool_self.bundling_fees_needed <= 0) {

      ////////////////
      // FREE block //
      ////////////////
      //
      // to avoid flooding, we only let nodes create a free
      // block for the money if they are not connected to any
      // other peers.
      //
      // otherwise they need at least one normal transaction
      //
      if (mempool_self.returnNormalTransactionsInMempool() == 0) {
        if (mempool_self.app.options.peers != null) {
          if (mempool_self.app.options.peers.length > 0) {
            if (mempool_self.app.options.server != null) {
              if (mempool_self.app.options.peers.length == 1 && mempool_self.app.options.peers[0].host == mempool_self.app.options.server.host) {} else { 
	        return;
	      }
            } else {
              return;
            }
          }
        }
      }


      ///////////////////////////
      // NON-FREE block if ... //
      ///////////////////////////
      //
      // 1. we have a golden ticket or normal transaction
      //
      if (mempool_self.containsGoldenTicket() == 0 && latestBlk.block.id != 0 && mempool_self.returnNormalTransactionsInMempool() == 0) { return; }

      //
      // 2. we are a full nodes or at least do not have NO blocks (to avoid flooding on boot)
      //
      if ( (mempool_self.app.BROWSER == 0 && mempool_self.app.SPVMODE == 0) || mempool_self.app.blockchain.index.hash.length > 0) {

        //
	// 3. and our mempool doesn't have blocks queued
	//
	if (mempool_self.blocks.length == 0) {
	 
	  //
	  // UNCOMMENT FOR SPAMMER MODULE TESTING
	  // 
	  // if stress-testing the network, we need to make sure 
	  // we have enough time to generate a golden ticket in 
	  // order to avoid never generating new transaction slips.
	  //
	  //if (mempool_self.containsGoldenTicket() == 1 || mempool_self.app.blockchain.index.hash.length == 0) {
          //
	    mempool_self.bundleBlock(latestBlk);
	  //
	  //}
	  //
	}
      }
    }
  }
};


