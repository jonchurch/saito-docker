'use strict';

const saito = require('../saito');


/////////////////
// Constructor //
/////////////////
function Miner(app) {

  if (!(this instanceof Miner)) {
    return new Miner(app);
  }

  this.app                      = app || {};

  this.mining                   = 1;    // do we mine blocks
  this.mining_timer             = null; // timer to loop creating block
  this.mining_speed             = 500;  // try to create a block every half-second
  this.currently_mining         = 0;    // timer to loop creating block

  return this;

}
module.exports = Miner;




/////////////////////
// attemptSolution //
/////////////////////
//
// try to produce a solution to the golden ticket
// embodied in the previous block (supplied as an
// argument to this function)
//
// @params {saito.block} previous_block
//
Miner.prototype.attemptSolution = function attemptSolution(prevblock) {

  if (prevblock == null) { return; }
  if (prevblock.is_valid == 0) { return; }

  // similar code used to validate golden tickets in golden ticket class validate function
  let ourPrivateKey = this.app.wallet.returnPrivateKey();
  let ourPublicKey  = this.app.wallet.returnPublicKey();
  let prevBlockHash = prevblock.returnHash();
  let randomNumber  = Math.random().toString();
  let hashValue     = this.app.crypt.hash(ourPublicKey + randomNumber);

  let decDifficulty = (prevblock.returnDifficulty() - Math.floor(prevblock.returnDifficulty()));
  let decDifficulty = decDifficulty.toFixed(8);
  let intDifficulty = Math.floor(prevblock.returnDifficulty());

  let h1 = null;
  let h2 = null;

  if (intDifficulty == 0) {
    h1 = 1;
    h2 = 1;
  } else {
    h1 = hashValue.slice((-1 * intDifficulty));
    h2 = prevblock.returnHash().slice((-1 * intDifficulty));
  }

  if (h1 == h2) {

    let h3 = hashValue.toString().toLowerCase()[ourPublicKey.length-1-intDifficulty];
    let h4 = parseInt(h3,16);
    let intTheDiff = Math.floor((decDifficulty * 10000));
    let intModBase = 625;
    let intResult  = Math.floor((intTheDiff/intModBase));

    if (h4 >= intResult) {

      this.stopMining();

      let gt = new saito.goldenticket(this.app);
      gt.createSolution(prevblock, ourPublicKey, ourPrivateKey, randomNumber);

      // find the winners
      let winners = gt.findWinners(prevblock);

      // create golden transaction
      let nt = this.app.wallet.createGoldenTransaction(winners, gt.solution);

      // add to mempool and broadcast
      this.app.mempool.addTransaction(nt);
      this.app.network.propagateGoldenTicket(nt);
    }
  }
}


/////////////////
// startMining //
/////////////////
//
// start a timer that tries to find solutions to 
// golden tickets
//
// @params {saito.block} prevblock
//
Miner.prototype.startMining = function startMining(blk) {

  if (blk == null) { return; }
  if (blk.is_valid == 0) { return; }

  if (this.currently_mining == 1) { clearInterval(this.mining_timer); }
  this.currently_mining = 1;

  var miner_self = this;

  this.mining_timer = setInterval(function(){
    miner_self.attemptSolution(blk);
  }, this.mining_speed);

}


////////////////
// stopMining //
////////////////
//
// stop the timer loop for solving golden tickets
//
Miner.prototype.stopMining = function stopMining() {
  clearInterval(this.mining_timer);
}



