'use strict';

const saito = require('../saito');



/////////////////
// Constructor //
/////////////////
function Wallet(app) {

  if (!(this instanceof Wallet)) {
    return new Wallet(app);
  }

  this.app     = app || {};

  //////////////////
  // options vars //
  //////////////////
  this.wallet                     = {};
  this.wallet.balance             = parseFloat(0.0);
  this.wallet.privateKey          = "";
  this.wallet.publicKey           = "";
  this.wallet.identifier          = "";
  this.wallet.utxi                = [];
  this.wallet.utxo                = [];
  this.wallet.default_fee         = 2;
  this.wallet.version             = 1.79;


  ///////////////
  // fast mode //
  ///////////////
  //
  // designed for speed tests on a single computer sending and 
  // receiving transactions on a non-forking chain using spammer
  // module.
  //
  this.store_utxo                 = 0; // 1 = store utxo
  this.speed_test		  = 0; // trust all inputs


  /////////////
  // hashmap //
  /////////////
  //
  // Bitcoin refers generally to all slips as UTXO. In Saito 
  // we distinguish between UTXI (slips we have yet to spent
  // which are valid to spend) and UTXO (slips we have spent
  // which may or may not be valid for others to spend).
  //
  // We make this distinction mostly for ease for reference 
  // here in the wallet class.
  //
  // These hashmaps are used to speed up the process of 
  // checking whether inputs/outputs already exist. It is
  // possible for them to be inaccurate in that UTXI may 
  // be reported as existing which are already spent, but 
  // since we use them to check for duplicate inserts when
  // syncing the chain this is not a problem.
  //
  this.utxi_hashmap               = [];
  this.utxo_hashmap               = [];
  this.utxi_hashmap_counter 	  = 0;
  this.utxi_hashmap_counter_limit = 10000;


  /////////////////////////
  // UTXO storage limits //
  /////////////////////////
  //
  // we do not store all UTXO in perpetuity, as that would
  // cause our options file to expand out of control. And 
  // storing large amounts of UTXO makes it slower to add 
  // incoming UTXI and outgoing UTXO.
  //
  // these variables specify how many UTXO we keep in our
  // wallet before purging them. If there is a chain re-
  // organization and we have already discarded our UTXO
  // then the funds are lost.
  //
  this.utxo_storage_counter      = 0;
  this.utxo_storage_limit        = 1000; // keep only the last 1000 spent slips
  this.utxo_purged_bid           = 0;


  /////////////////
  // spent slips //
  /////////////////
  //
  // this tracks the UTXI that we have already spent this
  // block so that we do not attempt to use the same UTXI 
  // slip twice. It is reset after every block.
  //
  this.spent_slips               = [];
  this.spent_slips_idx           = 0;

  return this;

}
module.exports = Wallet;


////////////////
// Initialize //
////////////////
//
// when we initialize the wallet we fetch our wallet info
// from our options file or generate a new wallet if this
// does not exist.
//
Wallet.prototype.initialize = function initialize() {

  if (this.wallet.privateKey == "") {

    ///////////////////
    // wallet exists //
    ///////////////////
    if (this.app.options.wallet != null) {

      //////////////////////////
      // reset if out-of-date //
      //////////////////////////
      //
      // we keep our public and private keys, but reset the 
      // UTXI and UTXO data and force a clean reset of the
      // blockchain tracking information
      //
      if (this.app.options.wallet.version != this.wallet.version) {

	if (this.app.BROWSER == 1) {

          this.app.options.wallet.version = this.wallet.version;

          let tmpprivkey = this.app.options.wallet.privateKey;
          let tmppubkey = this.app.options.wallet.publicKey;
          let tmpid = this.app.options.wallet.identifier;

	  // specify before reset to avoid archives reset problem
          this.wallet.publicKey = tmppubkey;
          this.wallet.privateKey = tmpprivkey;
          this.wallet.identifier = tmpid;

          // reset and save
          this.app.storage.resetOptions();
          this.app.storage.saveOptions();

	  // re-specify after reset
          this.wallet.publicKey = tmppubkey;
          this.wallet.privateKey = tmpprivkey;
          this.wallet.identifier = tmpid;

	  this.app.options.wallet = this.wallet;
	  this.saveWallet();

          this.app.archives.resetArchives();

          // reset blockchain
  	  this.app.options.blockchain.latest_block_id = "";
  	  this.app.options.blockchain.latest_block_hash = "";

          alert("Saito Upgrade: Wallet Reset");

        }
      }
      this.wallet = this.app.options.wallet;
    }

    //////////////////////////
    // wallet doesn't exist //
    //////////////////////////
    if (this.wallet.privateKey == "") {
      this.generateKeys();
    }
  }

  //////////////////
  // import slips //
  //////////////////
  if (this.app.options.wallet != null) {
    if (this.app.options.wallet.utxi != null) {
      for (let i = 0; i < this.app.options.wallet.utxi.length; i++) {
        this.wallet.utxi[i] = new saito.slip(
	  this.app.options.wallet.utxi[i].add,
	  this.app.options.wallet.utxi[i].amt,
	  this.app.options.wallet.utxi[i].gt,
	  this.app.options.wallet.utxi[i].bid,
	  this.app.options.wallet.utxi[i].tid,
	  this.app.options.wallet.utxi[i].sid,
	  this.app.options.wallet.utxi[i].bhash,
	  this.app.options.wallet.utxi[i].lc,
	  this.app.options.wallet.utxi[i].ft,
	  this.app.options.wallet.utxi[i].rn
	);
	this.spent_slips[i] = 0;

	////////////////////
	// update hashmap //
	////////////////////
        let hmi = this.returnHashmapIndex(this.wallet.utxi[i]);
        this.utxi_hashmap[hmi] = 1;
        this.utxi_hashmap_counter++;

      }
    }
    this.spent_slips_idx = 0;
    if (this.app.options.wallet.utxo != null) {
      for (let i = 0; i < this.app.options.wallet.utxo.length; i++) {
        this.wallet.utxo[i] = new saito.slip(
	  this.app.options.wallet.utxo[i].add,
	  this.app.options.wallet.utxo[i].amt,
	  this.app.options.wallet.utxo[i].gt,
	  this.app.options.wallet.utxo[i].bid,
	  this.app.options.wallet.utxo[i].tid,
	  this.app.options.wallet.utxo[i].sid,
	  this.app.options.wallet.utxo[i].bhash,
	  this.app.options.wallet.utxo[i].lc,
	  this.app.options.wallet.utxo[i].ft,
	  this.app.options.wallet.utxo[i].rn
	);

	////////////////////
	// update hashmap //
	////////////////////
        let hmi = this.returnHashmapIndex(this.wallet.utxo[i]);
        this.utxo_hashmap[hmi] = 1;
        this.utxo_hashmap_counter++;

      }
    }
  }

  this.purgeExpiredSlips();
  this.updateBalance();
  this.saveWallet();

console.log(this.wallet.utxi);

}















/////////////
// addUTXI //
/////////////
//
// adds a UTXI slip to our wallet.
//
// @param {saito.slip} UTXI slip
//
Wallet.prototype.addUTXI = function addUTXI(x) {

  //////////////
  // add slip //
  //////////////
  //  
  // we keep our UTXI array sorted according to block_id
  // so that we can (1) spend the earliest slips first, 
  // and (2) simplify deleting expired slips
  //
  let pos = this.wallet.utxi.length;
  while (pos > 0 && this.wallet.utxi[pos-1].bid > x.bid) { pos--; }
  if (pos == -1) { pos = 0; }

  this.wallet.utxi.splice(pos, 0, x);
  this.spent_slips.splice(pos, 0, 0);

  let hmi = this.returnHashmapIndex(x);
  this.utxi_hashmap[hmi] = 1;
  this.utxi_hashmap_counter++;

  
  ////////////////////////
  // regenerate hashmap //
  ////////////////////////
  //
  // we want to periodically re-generate our hashmaps
  // that help us check if UTXI and UTXO are already
  // in our wallet for memory-management reasons and 
  // to maintain reasonable accuracy.
  //
  if (this.utxi_hashmap_counter > this.utxi_hashmap_counter_limit) {
    this.utxi_hashmap = [];
    this.utxo_hashmap = [];
    for (let i = 0; i < this.wallet.utxi.length; i++) {
      let hmi = this.returnHashmapIndex(this.wallet.utxi[i]);
      this.utxi_hashmap[hmi] = 1;
    }
    for (let i = 0; i < this.wallet.utxo.length; i++) {
      let hmi = this.returnHashmapIndex(this.wallet.utxo[i]);
      this.utxo_hashmap[hmi] = 1;
    }
  }
  return;
}


/////////////
// addUTXO //
/////////////
//
// adds a UTXO slip to our wallet.
//
// @param {saito.slip} UTXO slip
//
Wallet.prototype.addUTXO = function addUTXO(x) {
 
  if (this.store_utxo == 0) { return; }

  //////////////
  // add slip //
  //////////////
  //
  // we don't bother storing UTXO outputs in any specific
  // order as we more rarely need to search through them
  //
  this.wallet.utxo.push(x);

  let hmi = this.returnHashmapIndex(x);
  this.utxo_hashmap[hmi] = 1;
  this.utxo_storage_counter++;


  ////////////////////
  // purge old utxo //
  ////////////////////
  //
  // delete excessive UTXO inputs to prevent options file expanding
  // uncontrollably. the downside is the potential for funds loss
  // with chain-reorganizations
  //
  if (this.utxo_storage_counter >= this.utxo_storage_limit) {
    console.log("Deleting Excessive UTXOs from heavy-spend wallet...");
    this.wallet.utxo.splice(0, this.wallet.utxo.length-this.utxo_storage_limit);
    this.utxo_storage_counter = 0;
  }
  return;
}


//////////////////////
// calculateBalance //
//////////////////////
//
// sums the total value of SAITO tokens in valid UTXI
// stored in this wallet.
//
// @returns (string) balance_of_wallet
//
Wallet.prototype.calculateBalance = function calculateBalance() {
  let b = 0.0;
  let minid = this.app.blockchain.returnLatestBlockId() - this.app.blockchain.returnGenesisPeriod() + 1;
  for (let x = 0; x < this.wallet.utxi.length; x++) {
    let s = this.wallet.utxi[x];
    if (s.lc == 1 && s.bid >= minid) {
      b = parseFloat(parseFloat(b) + parseFloat(s.amt)).toFixed(8);
    }
  }
  return b;
}


///////////////////////////////
// addRecipientToTransaction //
///////////////////////////////
//
// sums the total value of SAITO tokens in valid UTXI
// stored in this wallet.
//
// @param {saito.transaction} transaction
// @param {publickey} address
// @returns {saito.transaction}
//
Wallet.prototype.addRecipientToTransaction = function addRecipientToTransaction(tx, to) {
  tx.transaction.to.push(new saito.slip(to, 0.0));
  tx = this.signTransaction(tx);
  return tx;
}


//////////////////
// containsUTXI //
//////////////////
//
// does our wallet contain a UTXI slip?
//
// @param {saito.slip} slip
// @returns {boolean}
//
Wallet.prototype.containsUtxi = function containsUtxi(s) {

  let hmi = this.returnHashmapIndex(s);
  if (this.utxi_hashmap[hmi] == 1) { 
    return 1; 
  }

  return 0;
}


//////////////////
// containsUTXO //
//////////////////
//
// does our wallet contain a UTXO slip?
//
// @param {saito.slip} slip
// @returns {boolean}
//
Wallet.prototype.containsUtxo = function containsUtxo(s) {
  if (this.store_utxo == 0) { return 0; }

  let hmi = this.returnHashmapIndex(s);
  if (this.utxo_hashmap[hmi] == 1) { return 1; }

  return 0;
}


///////////////////////////////////////////
// createSignedTransactionWithForeignKey //
///////////////////////////////////////////
//
// create and sign a transaction using the information 
// submitted as arguments to this function. this is needed
// by modules that need to rebroadcast transactions that 
// are not technically stored in the Saito wallet.
//
// @param {string} recipient publickey
// @param {decimal} amount of slip value to send (remainder is fee)
// @param {string} publickey of utxi recipient
// @param {decimal} value of slip
// @param {integer} block_id of slip
// @param {integer} transaction_id of slip
// @param {integer} slip_id of slip
// @param {string} block_hash of block containing slip
// @param {string} publickey of utxi recipient
// @param {string} privatekey of utxi recipient
// @param {string} msg to include in transaction
//
// @returns {saito.transaction}
//
Wallet.prototype.createSignedTransactionWithForeignKey = function createSignedTransactionWithForeignKey(to_pubkey, send_amt = 0.0, slip_add, slip_amt, slip_bid, slip_tid, slip_sid, slip_bhash, slip_pubkey, slip_privkey, tx_msg) {

  var tx = new saito.transaction();
      tx.transaction.msg = tx_msg;
      tx.transaction.ts   = new Date().getTime();

  // recreate FROM slip
  var fslip       = new saito.slip();
      fslip.add   = slip_add;
      fslip.amt   = slip_amt;
      fslip.bid   = slip_bid;
      fslip.tid   = slip_tid;
      fslip.sid   = slip_sid;
      fslip.bhash = slip_bhash;
      fslip.lc    = 1;
      fslip.ft    = 0;

  // create TO slip
  var tslip       = new saito.slip(to_pubkey, send_amt);

  tx.transaction.from.push(fslip);
  tx.transaction.to.push(tslip);
  tx.transaction.msg = tx_msg;

  // sign transaction
  for (let i = 0; i < tx.transaction.to.length; i++) {
    tx.transaction.to[i].sid = i;
  }
  tx.transaction.msig   = this.signMessageWithForeignKey(tx.returnMessageSignatureSource(), slip_privkey);
  tx.transaction.sig    = this.signMessageWithForeignKey(tx.returnSignatureSource(), slip_privkey);
  return tx;

}


///////////////////////////////
// createUnsignedTransaction //
///////////////////////////////
//
// create a transaction with the appropriate slips given
// the desired fee and payment to associate with the 
// transaction, and a change address to receive any
// surplus tokens.
// 
// @param {string} recipient publickey
// @param {decimal} payment amount
// @param {decimal} fee to send with tx
//
// @returns {saito.transaction} if successful
// @returns {null} if inadequate inputs 
//
Wallet.prototype.createUnsignedTransaction = function createUnsignedTransaction(to_pubkey, amt = 0.0, fee = 0.0) {

  var tx = new saito.transaction();

  var total_fees = parseFloat(amt) + parseFloat(fee);
  if (total_fees > this.returnBalance()) { return null; }

  tx.transaction.from = this.returnAdequateInputs(total_fees);
  tx.transaction.ts   = new Date().getTime();
  tx.transaction.to.push(new saito.slip(to_pubkey, amt));

  if (tx.transaction.from == null) { return null; }

  // add change input
  var total_inputs = 0.0;
  if (fee > 0) {
    for (var i = 0; i < tx.transaction.from.length; i++) {
      total_inputs = parseFloat(total_inputs) + parseFloat(tx.transaction.from[i].amt);
    }
  }
  var change_amount = (parseFloat(total_inputs)-parseFloat(total_fees));
  if (change_amount > 0) {
    tx.transaction.to.push(new saito.slip(this.returnPublicKey(), change_amount));
  }

  return tx;

}


/////////////////////////////////////////////
// createUnsignedTransactionWithDefaultFee //
/////////////////////////////////////////////
//
// create a transaction with the appropriate slips given
// the desired fee and payment to associate with the 
// transaction, and a change address to receive any
// surplus tokens. Use the default wallet fee.
// 
// @param {string} recipient publickey
// @param {decimal} fee to send with tx
//
// @returns {saito.transaction} if successful
// @returns {null} if inadequate inputs 
//
Wallet.prototype.createUnsignedTransactionWithDefaultFee = function createUnsignedTransactionWithDefaultFee(to_pubkey, amt = 0.0) {
  return this.createUnsignedTransaction(to_pubkey, amt, this.returnDefaultFee());
}


//////////////////////////
// createFeeTransaction //
//////////////////////////
//
// create a special "fee transaction / fee ticket" that 
// can be included in a block by the node that created it
// in order to collect the necessary fees. The node must
// collect the funds at its own address for this tx to be
// valid.
//
// @param {decimal} fee to collect
//
// @returns {saito.transaction} tx
//
Wallet.prototype.createFeeTransaction = function createFeeTransaction(my_fee) {

  var fslip = new saito.slip(this.returnPublicKey(), 0.0, 0); 
  fslip.ft = 1;

  var tx = new saito.transaction();
  tx.transaction.from.push(fslip);

  var tslip = new saito.slip(this.returnPublicKey(), my_fee, 0);
  tx.transaction.to.push(tslip);

  tx.transaction.ts  = new Date().getTime();
  tx.transaction.msg = "fees";
  tx.transaction.ft  = 1;

  tx = this.signTransaction(tx);

  return tx;

}




/////////////////////////////
// createGoldenTransaction //
/////////////////////////////
//
// create a special "golden ticket transaction" that claims
// the reward offered by a golden ticket. this function is 
// used by miners. the two UTXO slips are the winners of the 
// golden ticket.
//
// @param {array} winnning nodes
// @param {obj}   golden ticket solution
//
// @returns {saito.transaction} tx
//
Wallet.prototype.createGoldenTransaction = function createGoldenTransaction(winners, solution) {

  var tx = new saito.transaction();
  tx.transaction.from.push(new saito.slip(this.returnPublicKey(), 0.0, 1));

  tx.transaction.to.push(winners[0]);
  tx.transaction.to.push(winners[1]);
  tx.transaction.ts  = new Date().getTime();
  tx.transaction.gt  = solution;
  tx.transaction.msg = "golden ticket";

  tx = this.signTransaction(tx);

  return tx;

}


//////////////////
// generateKeys //
//////////////////
//
// generate new public/private keypair and save wallet
//
Wallet.prototype.generateKeys = function generateKeys() {
  this.wallet.privateKey = this.app.crypt.generateKeys();
  this.wallet.publicKey  = this.app.crypt.returnPublicKey(this.wallet.privateKey);
  this.app.storage.saveOptions();
}


///////////////////////////
// onChainReorganization //
///////////////////////////
//
// this function is triggered whenever the blockchain 
// undergoes a reorganization. we go through our set of
// utxi and update our list of which ones are spendable.
//
// @params {integer} block_id
// @params {integer} block_hash
// @params {integer} am_i_the_longest_chain
//
Wallet.prototype.onChainReorganization = function onChainReorganization(block_id, block_hash, lc) {
  for (let m = this.wallet.utxi.length-1; m >= 0; m--) {
    if (this.wallet.utxi[m].bhash == block_hash) { 
      this.wallet.utxi[m].lc = lc; 
    }
  }
  for (let m = this.wallet.utxo.length-1; m >= 0; m--) {
    if (this.wallet.utxo[m].bhash == block_hash) { 
      this.wallet.utxo[m].lc = lc; 
    }
  }
}


/////////////////////////
// paymentConfirmation //
/////////////////////////
//
// this is triggered (by the blockchain object) whenever we
// receive a block that has a transaction to or from us. we
// check to make sure we have not already processed it, as 
// sometimes that can happen if we are resyncing the chain, 
// and if we have not we add it to our UTXI or UTXO stores.
//
// note that this function needs to keep track of whether this
// block is part of the longest chain in order to know whether
// our wallet has received spendable money.
//
// @params {saito.block} new block
// @params {saito.transaction} new transaction
// @params {integer} am_i_the_longest_chain
//
Wallet.prototype.paymentConfirmation = function paymentConfirmation(blk, tx, lchain) {

  //
  // if this is a speed test, delete all previous inputs
  // in order to avoid the software needing to iterate
  // through loops to check for duplicate inserts.
  //
  if (this.speed_test == 1) {
    if (this.wallet.utxi.length > 0) {
      if (this.wallet.utxi[0].bid < blk.block.bid) {
        this.wallet.utxi = [];
      }
    }
  }

  //
  // inbound payments
  //
  if (tx.isTo(this.returnPublicKey())) {

    let slips = tx.returnSlipsTo(this.returnPublicKey());
    for (let m = 0; m < slips.length; m++) {

      var s       = new saito.slip(slips[m].add, slips[m].amt, slips[m].gt);
          s.bhash = blk.returnHash();
          s.bid   = blk.block.id;
          s.tid   = tx.transaction.id;
          s.sid   = slips[m].sid;
          s.lc    = lchain;
	  s.ft    = slips[m].ft;
	  s.rn    = slips[m].rn;
      if (s.amt > 0) { 

        //
	// if we are testing speed inserts, just
	// push to the back of the UTXI chain without
	// verifying anything
	//
	// this should not be run in production code
	// but lets us minimize wallet checks taking
	// up significant time during capacity tests
	// on other network code.
	//
	if (this.speed_test == 1) {
	  this.addUTXI(s);
	} else {
          if (this.containsUtxi(s) == 0) {
	    if (this.containsUtxo(s) == 0) {
	      this.addUTXI(s);
            }
          }
        }
      }
    }
  }

  // don't care about UTXO in speed tests
  if (this.speed_tests == 1) { return; }

  //
  // outbound payments
  //
  if (tx.isFrom(this.returnPublicKey()) && tx.transaction.gt == null) {
    var slips = tx.returnSlipsFrom(this.returnPublicKey());
    for (var m = 0; m < slips.length; m++) {
      var s = slips[m];
      for (var c = 0; c < this.wallet.utxi.length; c++) {
        var qs = this.wallet.utxi[c];
        if (
	  s.bid   == qs.bid &&
	  s.tid   == qs.tid &&
	  s.sid   == qs.sid &&
	  s.bhash == qs.bhash &&
	  s.amt   == qs.amt &&
	  s.add   == qs.add &&
	  s.rn    == qs.rn
	) {
          if (this.containsUtxo(s) == 0) {
	    this.addUTXO(this.wallet.utxi[c]);
          }
	  this.wallet.utxi.splice(c, 1);
	  this.spent_slips.splice(c, 1);
	  c = this.wallet.utxi.length+2;
	}
      }
    }
  }
}




///////////////////////
// purgeExpiredSlips //
///////////////////////
//
// remove UTXI slips from our wallet that can no longer
// be spent because they have fallen off the transient
// blockchain.
//
Wallet.prototype.purgeExpiredSlips = function purgeExpiredSlips() {
  let gid = this.app.blockchain.returnGenesisBlockId();
  if (gid <= this.utxo_purged_bid) { return; }
  for (let m = this.wallet.utxi.length-1; m >= 0; m--) {
    if (this.wallet.utxi[m].bid < gid) {
      this.wallet.utxi.splice(m, 1);
      this.spent_slips.splice(m, 1);
    }
  }
  for (let m = this.wallet.utxo.length-1; m >= 0; m--) {
    if (this.wallet.utxo[m].bid < gid) {
      this.wallet.utxo.splice(m, 1);
    }
  }
  this.utxo_purged_bid = gid;
}



/////////////////
// resetWallet //
/////////////////
//
// return wallet to uninitialized state
//
Wallet.prototype.resetWallet = function resetWallet() {
  this.wallet.privateKey = "";
  this.wallet.publicKey  = "";
  this.wallet.identifier = "";
  this.wallet.balance    = parseFloat(0.0);
  this.wallet.utxi       = [];
  this.wallet.utxo       = [];
}


//////////////////////
// resetSpentInputs //
//////////////////////
//
// this function is triggered by our blockchain object every
// time we receive a new block. It empties the spent_slips 
// array that keeps track of which UTXI we have already spent
// (but that have not been confirmed).
//
// this is necessary to ensure we can identify unspent slips
// when hunting for UTXI to include in new transactions.
//
Wallet.prototype.resetSpentInputs = function resetSpentInputs() {
  for (let i = 0; i < this.wallet.utxi.length; i++) { 
    if (this.spent_slips[i] == 1) {
      this.spent_slips[i] = 0; 
    } else {
      i = this.wallet.utxi.length+2;
    }
  }
  this.spent_slips_idx = 0;
}


///////////////////
// returnAddress //
///////////////////
//
// returns the address / publickey of the wallet
//
// @returns {string} publickey
//
Wallet.prototype.returnAddress = function returnAddress() { 
  return this.wallet.publicKey; 
}


//////////////////////////
// returnAdequateInputs //
//////////////////////////
//
// given an amount of SAITO tokens, fetches an adequate number of
// UTXI slips and returns them as part of an array. If there are
// not enough tokens in the wallet, returns null.
//
// @params  {demical} amount of tokens needed
// @returns {array} array of saito.slips
// @returns null if insufficient UTXI
//
Wallet.prototype.returnAdequateInputs = function returnAdequateInputs(amt) {

  var utxiset = [];
  var value   = 0.0;

  var lowest_block = this.app.blockchain.returnLatestBlockId() - this.app.blockchain.returnGenesisPeriod();

      // +2 is just a safeguard (+1 because is next block, +1 for safeguard)
      lowest_block = lowest_block+2;

  this.purgeExpiredSlips();

  for (var i = this.spent_slips_idx; i < this.wallet.utxi.length; i++) {
    if (this.wallet.utxi[i].lc == 1 && this.wallet.utxi[i].bid >= lowest_block) {
      if (this.spent_slips[i] == 0) {
        this.spent_slips[i] = 1;
        this.spent_slips_idx = i+1;
        utxiset.push(this.wallet.utxi[i]);
        value = parseFloat(this.wallet.utxi[i].amt) + parseFloat(value);
        if (value >= amt) { return utxiset; }
      }
    }
  }
  return null;
}


///////////////////////////
// returnAvailableInputs //
///////////////////////////
//
// counts up the amount of SAITO tokens we have in our wallet
// and returns that. If this function is provided with a decimal
// indicating the limit, we stop and report the total value of
// the UTXI slips we have sufficient to cover that limit.
//
// @params  {decimal} amount of tokens needed
// @returns {decimal} value of tokens in wallet
//
Wallet.prototype.returnAvailableInputs = function returnAvailableInputs(limit=0) {

  var value   = 0.0;

  this.purgeExpiredSlips();

  // lowest acceptable block_id for security (+1 because is next block, +1 for safeguard)
  var lowest_block = this.app.blockchain.returnLatestBlockId() - this.app.blockchain.returnGenesisPeriod();
      lowest_block = lowest_block+2;

  // valculate value
  for (var i = this.spent_slips_idx; i < this.wallet.utxi.length; i++) {
    if (this.wallet.utxi[i].lc == 1 && this.wallet.utxi[i].bid >= lowest_block) {
      if (this.spent_slips[i] == 0) {
        value += parseFloat(this.wallet.utxi[i].amt) + parseFloat(value);
        if (value >= limit && limit != 0) {
	  return value;
	}
      }
    }
  }
  return value;
}


///////////////////
// returnBalance //
///////////////////
//
// returns balance of wallet in spendable SAITO tokens
//
// @returns {string} value of tokens in wallet
//
Wallet.prototype.returnBalance = function returnBalance() {
  this.wallet.balance = this.calculateBalance();
  return parseFloat(this.wallet.balance).toFixed(8);
}


//////////////////////
// returnDefaultFee //
//////////////////////
//
// writes persistent wallet data to options file
//
Wallet.prototype.returnDefaultFee = function returnDefaultFee() {
  return this.wallet.default_fee;
}


//////////////////////
// returnIdentifier //
//////////////////////
//
// returns main identifier associated with wallet publickey.
// cannot handle multiple identifiers, and so just reports
// the most recently registered DNS address.
//
// @returns {string} 
//
Wallet.prototype.returnIdentifier = function returnIdentifier() {
  return this.wallet.identifier;
}


////////////////////////
// returnHashmapIndex //
////////////////////////
//
// returns a string that will be unique for all of the slips 
// in our wallet. This is used in our utxi_hashmap and 
// utxo_hashmap objects to index the slips in our wallet for 
// quick lookup.
//
// @returns {string} 
//
Wallet.prototype.returnHashmapIndex = function returnHashmapIndex(slip) {
  return slip.bhash + slip.bid + slip.tid + slip.sid + slip.amt;
}


/////////////////////
// returnPublicKey //
/////////////////////
//
// return public key associated with wallet
//
// @returns {string} public key
//
Wallet.prototype.returnPublicKey = function returnPublicKey() {
  return this.wallet.publicKey;
}


/////////////////////
// returnPrivateKey //
/////////////////////
//
// return private key associated with wallet
//
// @returns {string} public key
//
Wallet.prototype.returnPrivateKey = function returnPrivateKey() {
  return this.wallet.privateKey;
}


////////////////
// saveWallet //
////////////////
//
// writes persistent wallet data to options file
//
Wallet.prototype.saveWallet = function saveWallet() {
  this.app.options.wallet = this.wallet;
  this.app.storage.saveOptions();
}


///////////////////
// setDefaultFee //
///////////////////
//
// sets default fee and saves options file
//
Wallet.prototype.setDefaultFee = function setDefaultFee(dfee) {
  this.wallet.default_fee = parseFloat(dfee);
  this.app.options.wallet = this.wallet;
  this.app.storage.saveOptions();
}


///////////////////////////////
// signMessageWithForeignKey //
///////////////////////////////
//
// this signs a string using the key provided. it is used together with the
// function createSignedTransactionWithForeignKey. the signature that is
// returned will be put in the msig field of the transcation according to 
// the Saito transaction protocol.
//
// @params {string} transaction message (likely JSON)
// @params {string} private key to use for signature
// @returns {string} message signature
//
Wallet.prototype.signMessageWithForeignKey = function signMessageWithForeignKey(msg, foreign_key) {
  return saito.crypt().signMessage(msg, foreign_key);
}


/////////////////
// signMessage //
/////////////////
//
// signs a msg string using the wallet private key.
//
// @params {string} message to sign
// @returns {string} public key
//
Wallet.prototype.signMessage = function signMessage(msg) {
  return saito.crypt().signMessage(msg, this.wallet.privateKey);
}


/////////////////////
// signTransaction //
/////////////////////
//
// signs a transaction using the wallet private key.
//
// @params {saito.transaction} transaction to sign
// @returns {saito.transaction} signed transaction
//
Wallet.prototype.signTransaction = function signTransaction(tx) {

  if (tx == null) { return null; }

  // ensure slip ids are properly sequential
  for (var i = 0; i < tx.transaction.to.length; i++) {
    tx.transaction.to[i].sid = i;
  }

  tx.transaction.msig   = this.signMessage(tx.returnMessageSignatureSource());
  tx.transaction.sig    = this.signMessage(tx.returnSignatureSource());
  return tx;
}


///////////////////
// updateBalance //
///////////////////
//
// calculates wallet balance and updates modules with it
//
Wallet.prototype.updateBalance = function updateBalance() {
  this.calculateBalance();
  this.app.modules.updateBalance();
}


//////////////////////
// updateIdentifier //
//////////////////////
//
// updates the default identifier associated with the wallet. this
// is the human-readable name that can be set by DNS modules. saves
// the wallet to ensure persistence.
//
// @params {string} identifier
//
Wallet.prototype.updateIdentifier = function updateIdentifier(id) {
  this.wallet.identifier = id;
  this.saveWallet();
}



