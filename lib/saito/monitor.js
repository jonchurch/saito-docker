'use strict';

const saito = require('../saito');


/////////////////
// Constructor //
/////////////////
function Monitor(app) {

  if (!(this instanceof Monitor)) {
    return new Monitor(app);
  }

  this.app = app || {};

  return this;

}
module.exports = Monitor;



////////////////////////
// readyToBundleBlock //
////////////////////////
//
// called by the mempool object to check if it is clear
// to create a block from its pool of available transaction.
//
// @returns {boolean}
//
Monitor.prototype.readyToBundleBlock = function readyToBundleBlock() {

  if (	this.app.mempool.currently_processing    == 0 &&
        this.app.mempool.currently_creating      == 0 &&
        this.app.mempool.currently_clearing      == 0 &&
        this.app.blockchain.currently_indexing   == 0 &&
        this.app.blockchain.currently_reclaiming == 0 &&
        this.app.storage.currently_reindexing    == 0
  ) { return 1; }
  return 0;

}


/////////////////////////////////
// readyToAddBlockToBlockchain //
/////////////////////////////////
Mempool.prototype.readyToAddBlockToBlockchain = function readyToAddBlockToBlockchain() {

  if (	this.app.blockchain.currently_indexing   == 0 &&
        this.app.blockchain.currently_reclaiming == 0 &&
        this.app.blockchain.currently_clearing   == 0 &&
        this.app.blockchain.currently_creating   == 0
  ) { return 1; }
  return 0;

}





