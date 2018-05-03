'use strict';

const saito = require('../saito');



/////////////////
// Constructor //
/////////////////
function Wallet(app, walletjson="") {

  if (!(this instanceof Wallet)) {
    return new Wallet(app, walletjson);
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
  this.wallet.version             = 1.60;


  ///////////////
  // fast mode //
  ///////////////
  //
  // designed for speed tests on a single computer sending and 
  // receiving transactions on a non-forking chain using spammer
  // module.
  //
  this.store_utxo                 = 0; // do not store utxo
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
Wallet.prototype.addRecipientToTransaction = function addRecipientToTransaction(tx, to) {
  tx.transaction.to.push(new saito.slip(to, 0.0));
  tx = this.signTransaction(tx);
  return tx;
}
Wallet.prototype.containsUtxi = function containsUtxi(s) {
  let hmi = this.returnHashmapIndex(s);
  if (this.utxi_hashmap[hmi] == 1) { return 1; }
  return 0;
}
Wallet.prototype.containsUtxo = function containsUtxo(s) {
  if (this.store_utxo == 0) { return 0; }
  let hmi = this.returnHashmapIndex(s);
  if (this.utxo_hashmap[hmi] == 1) { return 1; }
  return 0;
}
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
Wallet.prototype.createFeeTransaction = function createFeeTransaction(my_fee) {

  var fslip = new saito.slip(this.returnPublicKey(), 0.0, 0); 
  fslip.ft = 1;

  var tx = new saito.transaction();
  tx.transaction.from.push(fslip);

  tslip = new saito.slip(this.returnPublicKey(), my_fee, 0);
  tx.transaction.to.push(tslip);

  tx.transaction.ts  = new Date().getTime();
  tx.transaction.msg = "fees";
  tx.transaction.ft  = 1;

  tx = this.signTransaction(tx);

  return tx;

}
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
Wallet.prototype.generateKeys = function generateKeys() {
  this.wallet.privateKey = this.app.crypt.generateKeys();
  this.wallet.publicKey  = this.app.crypt.returnPublicKey(this.wallet.privateKey);
  this.app.storage.saveOptions();
}
Wallet.prototype.onChainReorganization = function onChainReorganization(block_id, block_hash, lc) {
  for (var m = this.wallet.utxi.length-1; m >= 0; m--) {
    if (this.wallet.utxi[m].bhash == block_hash) { 
      this.wallet.utxi[m].lc = lc; 
    }
  }
}
Wallet.prototype.initialize = function initialize() {

  if (this.wallet.privateKey == "") {
    if (this.app.options.wallet != null) {
      if (this.app.options.wallet.version != this.wallet.version) {
	if (this.app.BROWSER == 1) {

          this.app.options.wallet.version = this.wallet.version;

          var tmpprivkey = this.app.options.wallet.privateKey;
          var tmppubkey  = this.app.options.wallet.publicKey;
          var tmpid      = this.app.options.wallet.identifier;

	  // specify before reset to avoid archives reset problem
          this.wallet.publicKey  = tmppubkey;
          this.wallet.privateKey = tmpprivkey;
          this.wallet.identifier = tmpid;

          this.app.storage.resetOptions();
          this.app.storage.saveOptions();

	  // re-specify after reset
          this.wallet.publicKey  = tmppubkey;
          this.wallet.privateKey = tmpprivkey;
          this.wallet.identifier = tmpid;

          this.app.archives.resetArchives();

  	  this.app.options.blockchain.latest_block_id = "";
  	  this.app.options.blockchain.latest_block_hash = "";

          alert("Saito Upgrade: Wallet Reset");

        }
      }
      this.wallet = this.app.options.wallet;
    }
    if (this.wallet.privateKey == "") {
      this.generateKeys();
    }
  }

  // import slips
  if (this.app.options.wallet != null) {
    if (this.app.options.wallet.utxi != null) {
      for (var i = 0; i < this.app.options.wallet.utxi.length; i++) {
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
      }
    }
    this.spent_slips_idx = 0;
    if (this.app.options.wallet.utxo != null) {
      for (var i = 0; i < this.app.options.wallet.utxo.length; i++) {
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
      }
    }
  }

  this.purgeExpiredSlips();
  this.updateBalance();
  this.saveWallet();

}
Wallet.prototype.paymentConfirmation = function paymentConfirmation(blk, tx, lchain) {

  // if this is a speed test, delete all previous inputs
  // in order to avoid the software needing to iterate
  // through loops to check for duplicate inserts.
  //
  if (this.speed_test == 1) {
    if (this.wallet.utxi.length > 0) {
      if (this.wallet.utxi[0].bid > blk.block.bid) {
        this.wallet.utxi = [0];
      }
    }
  }

  // inbound
  if (tx.isTo(this.returnPublicKey())) {
    var slips = tx.returnSlipsTo(this.returnPublicKey());
    for (var m = 0; m < slips.length; m++) {

      var s       = new saito.slip(slips[m].add, slips[m].amt, slips[m].gt);
          s.bhash = blk.returnHash();
          s.bid   = blk.block.id;
          s.tid   = tx.transaction.id;
          s.sid   = slips[m].sid;
          s.lc    = lchain;
	  s.ft    = slips[m].ft;
	  s.rn    = slips[m].rn;
      if (s.amt > 0) { 

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
    	  this.wallet.utxi.push(s);
    	  this.spent_slips.push(0);
	} else {
          if (this.containsUtxi(s) == 0 && this.containsUtxo(s) == 0) {
	    this.addUTXI(s);
          }
        }
      }
    }
  }

  // do not handle outputs in speed tests
  if (this.speed_tests == 1) { return; }

  // outbound
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
//
// usually only run when resetting blockchain from disk
// but avoids issues as wallet can contain multiple slips
// unless we purge existing ones read-in at startup.
Wallet.prototype.purgeExistingBlockSlips = function purgeExistingBlockSlips(newblock) {
  for (var m = this.wallet.utxi.length-1; m >= 0; m--) {
    if (this.wallet.utxi[m].bhash == newblock.returnHash()) {
      this.wallet.utxi.splice(m, 1);
      this.spent_slips.splice(m, 1);
    }
  }
}
Wallet.prototype.purgeExpiredSlips = function purgeExpiredSlips() {
  var gid = this.app.blockchain.returnGenesisBlockId();
  if (gid <= this.utxo_purged_bid) { return; }
  for (var m = this.wallet.utxi.length-1; m >= 0; m--) {
    if (this.wallet.utxi[m].bid < gid) {
      this.wallet.utxi.splice(m, 1);
      this.spent_slips.splice(m, 1);
    }
  }
  for (var m = this.wallet.utxo.length-1; m >= 0; m--) {
    if (this.wallet.utxo[m].bid < gid) {
      this.wallet.utxo.splice(m, 1);
    }
  }
  this.utxo_purged_bid = gid;
}
Wallet.prototype.resetWallet = function resetWallet() {
  this.wallet.privateKey = "";
  this.wallet.publicKey  = "";
  this.wallet.identifier = "";
  this.wallet.balance    = parseFloat(0.0);
  this.wallet.utxi       = [];
  this.wallet.utxo       = [];
}
Wallet.prototype.resetSpentInputs = function resetSpentInputs() {
  for (var i = 0; i < this.wallet.utxi.length; i++) { 
    if (this.spent_slips[i] == 1) {
      this.spent_slips[i] = 0; 
    } else {
      i = this.wallet.utxi.length+2;
    }
  }
  this.spent_slips_idx = 0;
}
Wallet.prototype.returnAddress = function returnAddress() { 
  return this.wallet.publicKey; 
}
Wallet.prototype.returnAdequateInputs = function returnAdequateInputs(amt) {

  var utxiset = [];
  var value   = 0.0;

  var lowest_block = this.app.blockchain.returnLatestBlockId() - this.app.blockchain.returnGenesisPeriod();
      // +2 is just a safeguard  (+1 because is next block, +1 for safeguard)
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
Wallet.prototype.returnBalance = function returnBalance() {
  this.wallet.balance = this.calculateBalance();
  return parseFloat(this.wallet.balance).toFixed(8);
}
Wallet.prototype.returnIdentifier = function returnIdentifier() {
  return this.wallet.identifier;
}
Wallet.returnHashmapIndex = function returnHashmapIndex(slip) {
  return slip.bhash + slip.bid + slip.tid + slip.sid + slip.amt;
}
Wallet.prototype.returnPublicKey = function returnPublicKey() {
  return this.wallet.publicKey;
}
Wallet.prototype.returnPrivateKey = function returnPrivateKey() {
  return this.wallet.privateKey;
}
Wallet.prototype.returnWallet = function returnWallet() {
  return this.wallet;
}
Wallet.prototype.returnWalletJson = function returnWalletJson() {
  return JSON.stringify(this.wallet);
}
Wallet.prototype.saveWallet = function saveWallet() {
  this.app.options.wallet = this.returnWallet();
  this.app.storage.saveOptions();
}
Wallet.prototype.signMessageWithForeignKey = function signMessageWithForeignKey(msg, foreign_key) {
  return saito.crypt().signMessage(msg, foreign_key);
}
Wallet.prototype.signMessage = function signMessage(msg) {
  return saito.crypt().signMessage(msg, this.wallet.privateKey);
}
Wallet.prototype.signTransaction = function signTransaction(tx) {
  if (tx == null) { return null; }
  for (var i = 0; i < tx.transaction.to.length; i++) {
    tx.transaction.to[i].sid = i;
  }
  tx.transaction.msig   = this.signMessage(tx.returnMessageSignatureSource());
  tx.transaction.sig    = this.signMessage(tx.returnSignatureSource());
  return tx;
}
Wallet.prototype.updateBalance = function updateBalance() {
  this.calculateBalance();
  this.app.modules.updateBalance();
}
Wallet.prototype.updateIdentifier = function updateIdentifier(id) {
  this.wallet.identifier = id;
  this.saveWallet();
}
Wallet.prototype.verifyMessage = function verifyMessage(msg, sig, pubkey) {
  return saito.crypt().verifyMessage(msg, sig, pubkey);
}




