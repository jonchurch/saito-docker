'use strict';

const saito    = require('../saito');
const fs       = require('fs');
const shashmap = require('shashmap');
const path     = require('path');


/////////////////
// Constructor //
/////////////////
function Storage(app) {

  if (!(this instanceof Storage)) {
    return new Storage(app);
  }

  this.app  = app || {};

  this.db = null;

  this.data_directory             = path.join(__dirname, '../data/');

  this.saving_blocks              = 0;
  this.currently_reindexing       = 0;

  // syncing peers
  this.send_blocks_queue_limit    = 5;

  // loadBlocksFromDisk
  this.reindexing_chunk           = 0;
  this.reindexing_timer           = null;
  this.reindexing_speed           = 2000; // 0.5 seconds (add blocks)

  return this;
}
module.exports = Storage;


////////////////
// initialize //
////////////////
//
// opens existing database or creates a new one. we
// default our database to be as fast as possible at
// the cost of tolerance, because we can always
// reload from blocks on disk if necessary.
//
Storage.prototype.initialize = function initialize() {

  if (this.app.BROWSER == 0) {

    //////////////
    // database //
    //////////////
    var sqlite3 = require('sqlite3').verbose();
    this.db = new sqlite3.Database(this.data_directory + 'database.sq3');
    //this.db = new sqlite3.Database(':memory:');
    this.createDatabaseTables();

    // pragma temp store -- temp objects in memory (2) (default = 0)
    this.execDatabase("PRAGMA temp_store = 2", {}, function (){});

    // controls pagesize. default is 4096
    this.execDatabase("PRAGMA page_size = 32768", {}, function (){});

    // increase cache size (default is 1024)
    this.execDatabase("PRAGMA cache_size = 512000", {}, function (){});

    // radically faster db writes at cost of corruption on power failure
    this.execDatabase("PRAGMA synchronous = OFF", {}, function (){});

    // locking mode means only one connection (nodsjs) but increases speed (default: NORMAL)
    this.execDatabase("PRAGMA locking_mode = EXCLUSIVE", {}, function (){});

    // depreciated by small tweak
    this.execDatabase("PRAGMA count_changes = false", {}, function (){});

    // no rollbacks and db corruption on power failure
    this.execDatabase("PRAGMA journal_mode = OFF", {}, function (){});

  }

  //
  // load options file
  //
  this.loadOptions();
}







//////////////////////////
// createDatabaseTables //
//////////////////////////
//
// used in wallet module to check slip values
//
Storage.prototype.checkSlipValue = function checkSlipValue(utxi) {
  var hashmap_slip = this.returnHashmapIndex(utxi.bid, utxi.tid, utxi.sid, utxi.add, utxi.amt, utxi.bhash);
  return shashmap.slip_value(hashmap_slip);
}
//////////////////////////
// createDatabaseTables //
//////////////////////////
//
// run at initialization, this creates the database
// tables needed if they do not exist.
//
Storage.prototype.createDatabaseTables = function createDatabaseTables() {

  if (this.app.BROWSER == 1) { return; }

  var storage_self = this;

  this.execDatabase("\
    CREATE TABLE IF NOT EXISTS blocks (\
      id INTEGER, \
      reindexed INTEGER, \
      block_id INTEGER, \
      golden_ticket INTEGER, \
      min_tx_id INTEGER, \
      max_tx_id INTEGER, \
      block_json_id INTEGER, \
      hash TEXT, \
      conf INTEGER, \
      longest_chain INTEGER, \
      UNIQUE (block_id, hash), \
      PRIMARY KEY(id ASC) \
    )",
    {},
    function() {
      storage_self.app.storage.execDatabase("CREATE INDEX blocks_idx ON blocks (block_id, longest_chain)", {}, function() {});
      storage_self.app.storage.execDatabase("CREATE INDEX blocks_idx2 ON blocks (reindexed)", {}, function() {});
      storage_self.app.storage.execDatabase("CREATE INDEX blocks_idx3 ON blocks (hash)", {}, function() {});
    }
  );
}


//////////////////
// deleteBlocks //
//////////////////
//
// delete the non-slip data associated with blocks
// such as the local files as well as any information
// in our database
//
// @params {integer} lowest_block_id to keep
//
Storage.prototype.deleteBlocks = function deleteBlocks(block_id) {

  // browser apps dump old data
  if (this.app.BROWSER == 1) { return; }

  var storage_self = this;

  let sql = "SELECT * FROM blocks WHERE block_id < $block_id";
  let params = { $block_id: block_id }

  storage_self.queryDatabaseArray(sql, params, function (err, rows) {
    let sql7 = "DELETE FROM blocks WHERE block_id < $block_id";
    storage_self.db.run(sql7, { $block_id: block_id });

    if (err) {
      this.app.logger.logError("Error thrown in deleteBlocks", err);
    }
  });


  // defragment database periodically
  if (Math.random() < 0.005) {
    // LOGGING
    console.log(" ... defragmenting block database ... ");
    this.app.logger.logInfo(" ... defragmenting block database ... ");

    this.db.run("VACUUM", {}, function(err) {
      if (err) {
        this.app.logger.logError("Error thrown in deleteBlocks", err);
      }
    });
  }

}


//////////////////////
// deleteBlockSlips //
//////////////////////
//
// clears the slips in our Google Dense Hashmap
//
// @params {string} block hash
//
Storage.prototype.purgeBlockStorage = function purgeBlockStorage(block_hash) {

  var storage_self = this;

  this.openBlockByHash(block_hash, function(storage_self, blk) {

    if (blk == null) {} else {

      //
      // outer index implicity checks if any txs exists as
      // not every block has them (i.e. blk1)
      //
      if (blk.transactions != undefined) {
        for (let b = 0; b < blk.transactions.length; b++) {
          for (let bb = 0; bb < blk.transactions[b].transaction.to.length; bb++) {
            let slip_map_index = storage_self.returnHashmapIndex(blk.block.id, blk.transactions[b].transaction.id, blk.transactions[b].transaction.to[bb].sid, blk.transactions[b].transaction.to[bb].add, blk.transactions[b].transaction.to[bb].amt, block_hash);
            shashmap.delete_slip(slip_map_index);
          }
        }
      }

      //
      // deleting the block here ensures that we only remove it once we have
      // successfully purged all slips
      //
      let block_filename = __dirname + "/../data/blocks/" + blk.filename;
      fs.unlink(block_filename, function(err) {
        if (err) {
          this.app.logger.logError("Error thrown in purgeBlockStorage", err);
        }
      });

    }

  });

}


//////////////////
// execDatabase //
//////////////////
//
// executes an SQL command like INSERT, UPDATE, etc.
//
// @params {string} sql command
// @params {{"param1":"value1"}} parameters
// @params {callback} function to call with any results
//
Storage.prototype.execDatabase = function execDatabase(sql, params, callback=null) {
  var storage_self = this;
  
  if (this.app.BROWSER == 1) { return; }
  this.db.run(sql, params, function (err, row) {
    if (callback != null) {
      callback(err, row);
    }
    if (err) {
      storage_self.app.logger.logError("Error thrown in execDatabase", err);
    }
  });
}


/////////////////
// isSlipSpent //
/////////////////
Storage.prototype.isSlipSpent = function isSlipSpent(slip, current_bid) {
  if (slip == null) { return; }
  var slip_map_index = this.returnHashmapIndex(slip.bid, slip.tid, slip.sid, slip.add, slip.amt, slip.bhash);
  return shashmap.validate_slip_spent(slip_map_index, current_bid);
}


////////////////////////
// loadBlocksFromDisk //
////////////////////////
//
// This function is called by teh Blockchain class when it 
// initializes. It looks to see if we have any blocks saved
// to disk and -- if so -- force-adds them to the blockchain.
//
// This is done in chunks in order to avoid exhausting all of
// our memory. Logically, we should have no more than two 
// blocks getting processed at a time -- one working its way
// through the addBlockToBlockchain process in the blockchain
// class and another sitting queued up in the mempool.
//
// @params {integer} how many blocks to index
//
Storage.prototype.loadBlocksFromDisk = function loadBlocksFromDisk(mylimit=0) {

  if (this.app.BROWSER == 1 || this.app.SPVMODE == 1) { return; }

  var storage_self = this;
      storage_self.currently_reindexing = 1;

  //
  // sort files by creation date, and then name
  // if two files have the same creation date
  //
  let dir   = storage_self.data_directory + "blocks/";
  //
  // if this takes a long time, our server can 
  // just refuse to sync the initial connection
  // as when it starts to connect, currently_reindexing
  // will be set at 1
  //
  let files = fs.readdirSync(dir);

  //
  // "empty" file only
  //
  if (files.length == 1) {
    storage_self.currently_reindexing = 0;
    return;
  }

  this.block_size_current         = 0.0;
  files.sort(function(a, b) {
    var compres = fs.statSync(dir + a).mtime.getTime() - fs.statSync(dir + b).mtime.getTime();
    // if exact same creation time... string compare on names to fetch lower ID
    if (compres == 0) {
      return parseInt(a) - parseInt(b);
    }
    return compres;
  });

  let current_block = 0;

  //
  // our timer periodically checks to see if we
  // can process another file off disk and onto
  // the blockchain
  //
  storage_self.reindexing_timer = setInterval(function() {

    //
    // only move forward when we are allowed to
    // process some new blocks.
    //
    if (storage_self.reindexing_chunk == 1) { return; }
    if (storage_self.app.mempool.blocks.length < 1) {

      //
      // the "empty" file is needed by git to create the
      // blocks directory in the first place, so we hard-
      // code a special case for it.
      //
      if (files[current_block] == "empty") { current_block++; }

      //
      // end if we have nothing left to do
      //
      if (current_block > files.length-1 || files.length == 0) {

        //
        // now that we have synced, fetch blockchain
        //
        storage_self.app.network.fetchBlockchain();
        storage_self.currently_reindexing = 0;
        clearInterval(storage_self.reindexing_timer);
        return;
      }

      //
      // we track this to know when we have finished
      // re-indexing a chunk of data
      //
      storage_self.reindexing_chunk = 1;

      try {
        storage_self.openBlockByFilename(files[current_block], function(storage_self, blk) {

          if (blk == null) {
            console.log("Error loading block from disk: missing block: " +files[current_block]);
            storage_self.app.logger.logError(`Error loading block from disk: missing block: ${files[current_block]}`,
              { message: "", error: "" });
            process.exit();
          }

          let thisBlockId = files[current_block].substr(0, files[current_block].indexOf("-"));
          let thisDatabaseId = files[current_block].substr(files[current_block].indexOf("-") + 1, files[current_block].indexOf(".")-files[current_block].indexOf("-")-1);

          //
          // setting these fields allows our blockchain
          // class to take shortcuts and ensures that when
          // we add a block to the database it will be with
          // the right info.
          //
          blk.prevalidated   = 1; 		// force-add to index
                                      // cannot be set through json
                                      // prevents spamming network
          blk.saveBlockId    = thisBlockId; 	// block_id
          blk.saveDatabaseId = thisDatabaseId;  // id

          // LOGGING INFO
          storage_self.app.logger.logInfo(`REPOPULATING: adding block to mempool w/ id: ${blk.returnId()} -- ${blk.returnHash()}`)
          console.log(`REPOPULATING: adding block to mempool w/ id: ${blk.returnId()} -- ${blk.returnHash()}`);
          storage_self.app.mempool.addBlock(blk);
          storage_self.app.mempool.processBlocks();
          current_block++;
          storage_self.reindexing_chunk = 0;

        });
      } catch (err) {
        storage_self.app.logger.logError("Error thrown in loadBlocksFromDisk, setInterval", err);
      }
    }
  });
}



/////////////////
// loadPptions //
/////////////////
//
// load options file
//
Storage.prototype.loadOptions = function loadOptions() {

  var storage_self = this;

  /////////////
  // servers //
  /////////////
  if (this.app.BROWSER == 0) {

    try {
      this.app.options = JSON.parse(
        fs.readFileSync(__dirname + '/../options', 'utf8', (err, data) => {
          if (err) {
            console.log("Error Reading Options File");
            this.app.logger.logError("Error Reading Options File", err);
	          process.exit();
          }
        })
      );
    } catch (err) {
      console.log("Error Reading Options File");
      storage_self.app.logger.logError("Error Reading Options File", err);
      process.exit();
    }

  //////////////
  // browsers //
  //////////////
  } else {

    let data = null;


    ///////////////////////////////
    // fetch from Chrome Storage //
    ///////////////////////////////
    //
    // we should have already fetched
    // our data from the Chrome backend
    // storage. (start.js)
    //
    if (this.app.CHROME == 1) {
      if (this.app.options == null) { this.app.options = {}; }
      return;
    }



    ////////////////////////////
    // read from localStorage //
    ////////////////////////////
    if (typeof(Storage) !== "undefined") {
      data = localStorage.getItem("options");
      this.app.options = JSON.parse(data);
    }

    //////////////////////////
    // or fetch from server //
    //////////////////////////
    if (data == null) {
      $.ajax({
        url: '/client.options',
        dataType: 'json',
        async: false,
        success: function(data) {
          storage_self.app.options = data;
        },
        error: function(XMLHttpRequest, textStatus, errorThrown) {
          storage_self.app.logger.logError("Reading client.options from server failed", errorThrown)
        }
      });
    }
  }
}


///////////////////////////
// onChainReorganization //
///////////////////////////
//
// update our database when we reorganize the chain.
//
// n.b. this does not update Google Dense Hashmaps
//
// @params {integer} block_id
// @params {string} block hash
// @params {boolean} is longest chain?
//
Storage.prototype.onChainReorganization = function onChainReorganization(block_id, block_hash, lc) {

  if (this.app.BROWSER == 1 || this.app.SPVMODE == 1) { return; }

  var storage_self = this;

  storage_self.app.blockchain.lc_hashmap[block_hash] = lc;

  let sql = "UPDATE blocks SET longest_chain = $lc WHERE block_id = $block_id AND hash = $block_hash";
  this.db.run(sql, {
    $block_id: block_id,
    $block_hash: block_hash,
    $lc: lc
  }, function(err) {
    storage_self.app.logger.logError("db.run in onChainReorganization failed", err)
  });
}


/////////////////////
// openBlockByHash //
/////////////////////
//
// if a block exists with this hash, open it from disk
// and submit the block object to the callback, which
// provides a reference to this storage_self and the
// block object.
//
// @params {string} block hash
// @params {callback}(storage_self, block)
//
Storage.prototype.openBlockByHash = function openBlockByHash(block_hash, mycallback) {

  var storage_self = this;

  let sql    = "SELECT * FROM blocks WHERE hash = $block_hash";
  let params = { $block_hash : block_hash };

  this.db.all(sql, params, function (err, rows) {
    if (rows.length > 0) {

      let block_json_id   = rows[0].block_json_id;
      let block_id        = rows[0].block_id;
      let block_db_id     = rows[0].id;
      let blkjson         = "";
      let block_filename  = rows[0].block_id + "-" + rows[0].id + ".blk";
      storage_self.openBlockByFilename(block_filename, mycallback);

    } else {

      //
      // failure
      //
      mycallback(storage_self, null);

    }

    if (err) {
      this.app.logger.logError("Error in openBlockByHash", err)
    }
  });
}


/////////////////////////
// openBlockByFilename //
/////////////////////////
//
// if a block exists with name, open it from disk and
// submit the block object to the callback, which
// provides a reference to this storage_self and the
// block object.
//
// @params {string} block filename
// @params {callback}(storage_self, block)
//
Storage.prototype.openBlockByFilename = function openBlockByFilename(filename, mycallback) {

  var storage_self = this;

  let block_filename  = filename;
  let block_filename2 = storage_self.data_directory + "blocks/" + filename;

  try {
    //
    // readFileSync leads to issues loading from
    // disk. for some reason the only file is not
    // opened and we never hit the function inside
    //
    if (fs.existsSync(block_filename2)) {
      fs.readFile(block_filename2, 'utf8', (err, data) => {
        var blk = new saito.block(storage_self.app, data);
        if (blk.is_valid == 0) { mycallback(storage_self, null); }
        mycallback(storage_self, blk);
      });
    } else {
      console.log("cannot open: " + block_filename2 + " as it does not exist on disk");
      mycallback(storage_self, null);
    }
  } catch (err) {
    console.log("Error reading block from disk");
    storage_self.app.logger.logError("Error reading block from disk", err)
  }
}


///////////////////
// queryDatabase //
///////////////////
//
// executes an SQL command like SELECT
//
// @params {string} sql command
// @params {{"param1":"value1"}} parameters
// @params {callback} function to call with any results
//
Storage.prototype.queryDatabase   = function queryDatabase(sql, params, callback) {
  if (this.app.BROWSER == 1) { return; }
  this.db.get(sql, params, function (err, row) {
    callback(err, row);

    if (err) {
      storage_self.app.logger.logError("Error from queryDatabase", err)
    }
  });
}


////////////////////////
// queryDatabaseArray //
////////////////////////
//
// executes an SQL command like SELECT with multiple rows
//
// @params {string} sql command
// @params {{"param1":"value1"}} parameters
// @params {callback} function to call with any results
//
Storage.prototype.queryDatabaseArray = function queryDatabaseArray(sql, params, callback) {
  if (this.app.BROWSER == 1) { return; }
  this.db.all(sql, params, function (err, rows) {
    callback(err, rows);

    if (err) {
      storage_self.app.logger.logError("Error from queryDatabaseArray", err);
    }
  });
}


//////////////////
// resetOptions //
//////////////////
//
// resets options file
//
Storage.prototype.resetOptions = function resetOptions() {

  var storage_self = this;

  //
  // prevents caching
  //
  let tmpdate = new Date().getTime();
  let loadurl = '/client.options?x='+tmpdate;

  $.ajax({
    url: loadurl,
    dataType: 'json',
    async: false,
    success: function(data) {
      storage_self.app.options = data;
      storage_self.saveOptions();
    },
    error: function(XMLHttpRequest, textStatus, errorThrown) {
      storage_self.app.logger.logError("Reading client.options from server failed", errorThrown);
    }
  });
}


////////////////////////
// returnHashmapIndex //
////////////////////////
//
// returns unique index string for Google Dense Hashmap
//
// @params {integer} block_id
// @params {integer} transaction_id
// @params {integer} slip_id
// @params {string} address
// @params {decimal} amount
// @params {string} block hash
//
Storage.prototype.returnHashmapIndex = function returnHashmapIndex(bid, tid, sid, add, amt, block_hash) {
  return bid.toString() + tid.toString() + sid.toString() + block_hash + amt;
}


///////////////
// saveBlock //
///////////////
//
// save new block data to database and disk and hashmap
//
Storage.prototype.saveBlock = function saveBlock(blk, lc = 0) {

  if (this.app.BROWSER == 1) { return; }
  if (blk == null) { return; }
  if (blk.is_valid == 0) { return; }

  var storage_self = this;
  this.saving_blocks     = 1;

  ///////////
  // slips //
  ///////////
  //
  // insert the "to" slips so that future blocks can manipulate them
  //
  for (let b = 0; b < blk.transactions.length; b++) {
    for (let bb = 0; bb < blk.transactions[b].transaction.to.length; bb++) {
      if (blk.transactions[b].transaction.to[bb].amt > 0) {
        var slip_map_index = storage_self.returnHashmapIndex(blk.block.id, blk.transactions[b].transaction.id, blk.transactions[b].transaction.to[bb].sid, blk.transactions[b].transaction.to[bb].add, blk.transactions[b].transaction.to[bb].amt, blk.returnHash());
        shashmap.insert_slip(slip_map_index, -1);
      }
    }
  }


  ///////////////////////////////
  // figure our min/max tx_ids //
  ///////////////////////////////
  let mintxid = 0;
  let maxtxid = 0;

  if (blk.transactions.length > 0) {
    let mintx = JSON.parse(blk.block.transactions[0]);
    let maxtx = JSON.parse(blk.block.transactions[blk.block.transactions.length-1]);
    maxtxid = maxtx.id;
    mintxid = mintx.id;
  }


  //////////////////////
  // save to database //
  //////////////////////
  var sql2 = "INSERT INTO blocks (block_id, golden_ticket, reindexed, block_json_id, hash, conf, longest_chain, min_tx_id, max_tx_id) VALUES ($block_id, $golden_ticket, 1, $block_json_id, $hash, 0, $lc, $mintxid, $maxtxid)";
  var params2 = {
    $block_id: blk.block.id,
    $golden_ticket: blk.containsGoldenTicket(),
    $block_json_id : 0,
    $hash: blk.returnHash(),
    $lc: lc,
    $mintxid: mintxid,
    $maxtxid: maxtxid
  };

  //
  // this is > -1 if we are reading the block
  // off disk and restoring our database, in
  // which case we want to use our prior IDs
  // to maintain consistency with the saved
  // blocks
  //
  if (blk.saveDatabaseId > -1) {
    sql2 = "INSERT INTO blocks (id, block_id, golden_ticket, reindexed, block_json_id, hash, conf, longest_chain, min_tx_id, max_tx_id) VALUES ($dbid, $block_id, $golden_ticket, 1, $block_json_id, $hash, 0, $lc, $mintxid, $maxtxid)";
    params2 =  {
      $dbid: blk.saveDatabaseId,
      $block_id: blk.block.id,
      $golden_ticket: blk.containsGoldenTicket(),
      $block_json_id : 0,
      $hash: blk.returnHash(),
      $lc: lc,
      $mintxid: mintxid,
      $maxtxid: maxtxid
    }
  }

  storage_self.db.run(sql2, params2, function(err) {

    if (err) {
console.log(err);
      storage_self.app.logger.logError("Error thrown in storage.saveBlock", err);
    }

    if (this.lastID != undefined) {

      //////////////////
      // save to disk //
      //////////////////
      var tmp_filename = blk.block.id + "-" + this.lastID + ".blk";
      var tmp_filepath = storage_self.data_directory + "blocks/" + tmp_filename;

      // write file if it does not exist
      if ( ! fs.existsSync(tmp_filepath)) {
        //
        // compresses segregated addresses, which
        // removes addresses to separate part of
        // block and puts a reference in the address
        // space allowing it to be reconstituted
        //
        // useful compression technique as many
        // transaction paths will have duplicate
        // address info
        //
        //blk.compressSegAdd();

        fs.writeFileSync(tmp_filepath, JSON.stringify(blk.block), 'UTF-8');

        //
        // set filename before we permit continuing
        //
        blk.filename = tmp_filename;
        storage_self.saving_blocks     = 0;
      } else {
        blk.filename = tmp_filename;
      }

    } else {

      ///////////////////
      // already saved //
      ///////////////////
      storage_self.saving_blocks = 0;
      return -1;

    }
  });

  return 1;
}


///////////////////////
// saveClientOptions //
///////////////////////
//
// when browsers connect to our server, we check to see
// if the client.options file exists in our web directory
// and generate one here if it does not.
//
// this is fed out to client browsers and serves as their
// default options, specifying us as the node to which they
// should connect and through which they can route their
// transactions. :D
//
Storage.prototype.saveClientOptions = function saveClientOptions() {

  if (this.app.BROWSER == 1) { return; }

  //
  // mostly empty, except that we tell them what our latest
  // block_id is and send them information on where our
  // server is located so that they can sync to it.
  //
  var t                  = {};
      t.archives             = [];
      t.keys                 = [];
      t.peers                = [];
      t.dns                  = [];
      t.blockchain           = {};
      t.blockchain.lastblock = this.app.blockchain.returnLatestBlockId();
      t.peers.push(this.app.server.server);

  // console.log("this.app.server in storage.js", this.app.server);
  // if (this.app.server.endpoint != null) {
  //   t.endpoint = this.app.server.endpoint;
  // }


  //
  // TESTING
  //
  // tell all clients they can use our archiving service
  //
  //var arc = {"host":"localhost","port":12101,"publickey":"", "active":"inactive"};
  //    arc.publickey = this.app.wallet.returnPublicKey();
  //    arc.active = "active";
  //t.archives.push(arc);


  //
  // if we are serving any DNS domains, we add these to our
  // client.options file as well so that our connected users
  // have the convenience of a DNS service.
  //
  if (this.app.options.dns != null) {
    //
    // TODO
    //
    // this only handles one
    let regmod = this.app.modules.returnModule("Registry");
    for (let x = 0; x < this.app.options.dns.length; x++) {
      if (regmod != null) {
        if (this.app.options.dns[x].domain = regmod.domain) {
          if (this.app.options.dns[x].publickey == "") { this.app.options.dns[x].publickey = this.app.wallet.returnPublicKey(); }
        }
      }
    }
    t.dns                = this.app.options.dns;
  }

  //
  // write the file
  //
  fs.writeFileSync("saito/web/client.options", JSON.stringify(t), function(err) {
    if (err) {
      storage_self.app.logger.logError("Error thrown in storage.saveBlock", err);
      console.log(err);
    }
  });

}


//////////////////////
// saveConfirmation //
//////////////////////
//
// update database to indicate we have given this block
// its confirmation. used when force-adding blocks to
// the database.
//
// @params {string} block_hash
// @params {integer} confirmation num
//
Storage.prototype.saveConfirmation = function saveConfirmation(hash, conf) {

  if (this.app.BROWSER == 1) { return; }

  let sql = "UPDATE blocks SET conf = $conf WHERE hash = $hash";
  this.db.run(sql, {
    $conf: conf,
    $hash: hash
  });
}


/////////////////
// saveOptions //
/////////////////
//
// save options file
//
Storage.prototype.saveOptions = function saveOptions() {

  var storage_self = this;

  if (storage_self.app.options == null) { storage_self.app.options = {}; }

  if (storage_self.app.CHROME == 1) {
    chrome.storage.local.set({'options': JSON.stringify(storage_self.app.options)});
    return;
  }

  if (this.app.BROWSER == 0) {
    fs.writeFileSync("options", JSON.stringify(storage_self.app.options), function(err) {
      if (err) {
        storage_self.app.logger.logError("Error thrown in storage.saveOptions", err);
        console.log(err);
        return;
      }
    });
  } else {
    if (typeof(Storage) !== "undefined") {
      localStorage.setItem("options", JSON.stringify(storage_self.app.options));
    }
  }
}


////////////////////
// sendBlockchain //
////////////////////
//
// this handles the process of sending chunks of the blockchain
// to a peer. We provide the peer and take care of managing the
// peer information ourselves depending on how data-syncing goes.
//
// TODO
//
// move this logic to the peer class
//
// @params {integer} block_id to start syncing from
// @parans {string} "full" or "lite"
// @params {saito.peer} peer to send stuff to
//
Storage.prototype.sendBlockchain = function sendBlockchain(start_bid, synctype, peer) {

  if (this.app.BROWSER == 1 || this.app.SPVMODE == 1) { return; }

  var storage_self = this;

  peer.sync_sending_bid    = start_bid;
  peer.sync_latest_bid     = this.app.blockchain.returnLatestBlockId();
  peer.sync_sending_db_bid = 0;
  peer.sync_sending        = 1;

  //
  // we start a timer, using the speed set in the
  // sync class. This allows a crude sort of rate-
  // limiting so that we don't crash the remote
  // node or kill ourselves with memory exhausting.
  //
  peer.sync_timer = setInterval(function() {

    if (peer.isConnected() != 1) {
      clearInterval(peer.sync_timer);
      peer.sync_sending = 0;
      peer.sync_sending_chunk = 0;
      return false;
    }

    if (peer.message_queue.length >= storage_self.send_blocks_queue_limit) { return; }
    if (peer.sync_sending_chunk == 1) { return; }

    peer.sync_sending_chunk = 1;

    var sql    = "SELECT count(*) AS count FROM blocks WHERE block_id >= $block_id AND id > $db_id ORDER BY block_id, id ASC";
    var params = { $block_id : peer.sync_sending_bid , $db_id : peer.sync_sending_db_bid };

    storage_self.db.get(sql, params, function (err, rowz) {
      if (err) {
        storage_self.app.logger.logError("Error thrown in storage.saveBlock", err);
      }

      if (rowz != null) {
        var count = rowz.count;
        if (count > 0) {
          if (peer.message_queue.length < storage_self.send_blocks_queue_limit) {
            storage_self.sendBlockchainChunk(peer);
          }
        } else {
          clearInterval(peer.sync_timer);
          peer.sync_sending = 0;
          peer.sync_sending_chunk = 0;
        }
      } else {
        clearInterval(peer.sync_timer);
        peer.sync_sending_chunk = 0;
        peer.sync_sending = 0;
      }
    });
  }, peer.sync_timer_speed);

}


/////////////////////////
// sendBlockchainChunk //
/////////////////////////
//
// we handle network capacity issues by running this on a timer
// which pumps out a block every so often.
//
// TODO
//
// move this logic to the peer class
//
// add some kind of callback so that we only send the next block
// when the previous one has been received in full.
//
// @parans {saito.peer} peer to send stuff to
//
Storage.prototype.sendBlockchainChunk = function sendBlockchainChunk(peer) {

  var storage_self = this;

  // send limit = this.send_block_queue_limit
  let sql    = "SELECT * FROM blocks WHERE blocks.block_id >= $block_id AND blocks.id >= $db_id ORDER BY block_id, id ASC LIMIT $db_limit";
  let params = { $block_id : peer.sync_sending_bid , $db_id : peer.sync_sending_db_bid , $db_limit : storage_self.send_blocks_queue_limit };

  this.app.storage.queryDatabaseArray(sql, params, function (err, rows) {
    if (rows == null) {
      peer.sync_sending = 0;
      peer.sync_sending_chunk = 0;
      clearInterval(peer.sync_timer);
      return;
    }

    for (let r = 0; r < rows.length; r++) {

      peer.sync_sending_db_bid = rows[r].id;
      peer.sync_sending_bid    = rows[r].block_id;

      let block_filename = rows[r].block_id + "-" + rows[r].id + ".blk";

      try {
        storage_self.openBlockByFilename(block_filename, function(storage_self, tmpblk) {
        // 0 means "queue it"
        if (tmpblk != null) {
          peer.sendBlock("block", tmpblk, 0);
        }
          peer.sync_sending_chunk = 0;
        });
      } catch (err) {
        console.log("Error reading block from disk");
        peer.sync_sending_chunk = 0;
        peer.sync_sending = 0;
        console.log("Error Reading Block File");

        storage_self.app.logger.logError("Error reading block from disk", {message: "", error: ""});
        storage_self.app.logger.logError("Error Reading Block File", {message: "", error: ""});
      }
    }
    if (peer.isConnected() != 1) {
      peer.sync_sending = 0;
      peer.sync_sending_chunk = 0;
      clearInterval(peer.sync_timer);
      return;
    }
  });
}




//////////////////////
// spendBlockInputs //
//////////////////////
//
// update Google Dense Hashmap to spend inputs in blok
//
// n.b.: you should have already validated they are spendable
// in validateBlockInputs
//
// @param {saito.block} block
//
Storage.prototype.spendBlockInputs = function spendBlockInputs(newblock) {

  if (this.app.BROWSER == 1 || this.app.SPVMODE == 1) { return; }

  var storage_self = this;

  for (let b = 0; b < newblock.transactions.length; b++) {
    for (let bb = 0; bb < newblock.transactions[b].transaction.from.length; bb++) {
      if (newblock.transactions[b].transaction.from[bb].amt > 0) {
        let slip_map_index = storage_self.returnHashmapIndex(newblock.transactions[b].transaction.from[bb].bid, newblock.transactions[b].transaction.from[bb].tid, newblock.transactions[b].transaction.from[bb].sid, newblock.transactions[b].transaction.from[bb].add, newblock.transactions[b].transaction.from[bb].amt, newblock.transactions[b].transaction.from[bb].bhash);
        shashmap.insert_slip(slip_map_index, newblock.block.id);
      }
    }
  }
  return 1;
}


////////////////////////
// unspendBlockInputs //
////////////////////////
//
// when unwinding a chain, we need to ensure all of the
// transaction inputs are restored to an unspent state so
// that the new chain will validate if it spends them on
// its alternate chain.
//
// this unspends the inputs associated with the submitted
// block
//
// @params {saito.block} block
//
Storage.prototype.unspendBlockInputs = function unspendBlockInputs(blk) {
  for (let x = 0; x < blk.transactions.length; x++) {
    for (let y = 0; y < blk.transactions[x].transaction.from.length; y++) {
      let utxi  = blk.transactions[x].transaction.from[y];
      if (utxi.amt > 0) {
        let slip_map_index = this.returnHashmapIndex(utxi.bid, utxi.tid, utxi.sid, utxi.add, utxi.amt, utxi.bhash);
        shashmap.insert_slip(slip_map_index, -1);
      }
    }
  }
  return 1;
}


/////////////////
// unwindChain //
/////////////////
//
// this rolls back the old Longest Chain and resets all of the slips
// that were SPENT to a fresh state so that our competing chain will
// have them available when it tries to roll out (and validate) its
// proposed longest chain.
//
// once we have unwound the entire longest chain, we call the windChain
// function which takes responsibility for rolling out, validating and
// possibly restoring the oldest chain if there are problems.
//
// @params {saito.block} newest block
// @params {interger} newest block index in blockchain.index
// @params {integer} block index of last-common-ancestor blockchain.index
// @params {array} array of block indexes for new blocks becoming longest chain
// @params {array} array of block hashes for new blocks becoming longest chain
// @params {array} array of block_ids for new blocks becoming longest chain
// @params {array} array of block indexes for existing blocks losing longest chain
// @params {array} array of block hashes for existing blocks losing longest chain
// @params {array} array of block_ids for existing blocks losing longest chain
// @params {integer} is newest block longest chain (should be 1)
// @params {string} "force" if block is loaded from disk
// @params {integer} position in above old_block_* arrays of this block
// @params {integer} 1 if we are unwinding a bad new chain
//
Storage.prototype.unwindChain = function unwindChain(newblock, pos, shared_ancestor_index_pos, new_block_idxs, new_block_hashes, new_block_ids, old_block_idxs, old_block_hashes, old_block_ids, i_am_the_longest_chain, forceAdd, current_unwind_index, resetting_flag) {

  var storage_self = this;

  console.log(" ... unwind old chain");
  storage_self.app.logger.logInfo(" ... unwind old chain");

  var storage_self = this;

  if (old_block_hashes.length > 0) {
    //
    // unspend the slips in this block. We know that
    // the block has been saved to disk so we just open
    // block by hash.
    //
    storage_self.app.blockchain.returnBlockByHash(old_block_hashes[current_unwind_index], function(blk) {

      if (blk == null) {
        console.log("We cannot find a block on disk that should exist in unwindChain");
        storage_self.app.logger.logError("We cannot find a block on disk that should exist in unwindChain",
          { message: "", err: "" });
	      process.exit();
      }

      storage_self.app.storage.onChainReorganization(blk.block.id, blk.returnHash(), 0);
      storage_self.app.wallet.onChainReorganization(blk.block.id, blk.returnHash(), 0);
      storage_self.app.modules.onChainReorganization(blk.block.id, blk.returnHash(), 0);
      storage_self.app.blockchain.index.lc[old_block_idxs[current_unwind_index]] = 0;

      //
      // if we are the node that produced this block, we catch any transactions
      // that were added to it. we want to add these transactions back into our
      // mempool once the chain has been rewritten if their inputs are still
      // valid.
      //
      if (storage_self.app.wallet.returnPublicKey() == blk.block.miner) {

	      //
        // a block that we created is getting undone, so we push all of the
	      // transactions into a special queue that exists in our mempool for
	      // us to check once we have finished re-writing the chain.
        //
        if (blk.transactions != null) {
          for (let i = 0; i < blk.transactions.length; i++) {
            storage_self.app.mempool.recoverTransaction(blk.transactions[i]);
          }
        }

      }


      storage_self.unspendBlockInputs(blk);

      //
      // we either move on to our next block, or we hit
      // the end of the chain of blocks to unspend and
      // move on to wind the proposed new chain
      //
      if (current_unwind_index == 0) {
        storage_self.windChain(newblock, pos, shared_ancestor_index_pos, new_block_idxs, new_block_hashes, new_block_ids, old_block_idxs, old_block_hashes, old_block_ids, i_am_the_longest_chain, forceAdd, 0, resetting_flag);
      } else {
        storage_self.unwindChain(newblock, pos, shared_ancestor_index_pos, new_block_idxs, new_block_hashes, new_block_ids, old_block_idxs, old_block_hashes, old_block_ids, i_am_the_longest_chain, forceAdd, current_unwind_index-1, resetting_flag);
      }

    });

  } else {
    storage_self.windChain(newblock, pos, shared_ancestor_index_pos, new_block_idxs, new_block_hashes, new_block_ids, old_block_idxs, old_block_hashes, old_block_ids, i_am_the_longest_chain, forceAdd, 0, resetting_flag);
  }
}


/////////////////////////
// validateBlockInputs //
/////////////////////////
//
// are all inputs in a block valid?
//
// @params {saito.block} block
// @returns {boolean} is valid
//
Storage.prototype.validateBlockInputs = function validateBlockInputs(newblock, prevblk, prevblk_permitted_null=0) {

  var storage_self = this;

  console.log(" ... validate block inputs and other stuff");
  storage_self.app.logger.logInfo(" ... validate block inputs and other stuff");

  if (this.app.BROWSER == 1 || this.app.SPVMODE == 1) { return 1; }

  var storage_self = this;
  let spent_inputs = [];

  /////////////////////////////////////////
  // check against double-input spending //
  /////////////////////////////////////////
  var tmpgtfound = 0;
  var tmpftfound = 0;
  for (var ti = 0; ti < newblock.transactions.length; ti++) {
    let tx = newblock.transactions[ti];
    for (var ti2 = 0; ti2 < tx.transaction.from.length; ti2++) {
      let tmpbid = tx.transaction.from[ti2].bid;
      let tmptid = tx.transaction.from[ti2].tid;
      let tmpsid = tx.transaction.from[ti2].sid;

      // we may have multiple transactions claiming 0/0/0
      // these will be golden ticket and fee ticket tx
      let tmpgt  = tx.transaction.from[ti2].gt;
      let tmpft  = tx.transaction.from[ti2].ft;

      // only 1 ft-tagged slip in the FROM
      if (tmpft == 1) {
        if (tmpftfound == 1) {
          // LOG INFO
          storage_self.app.logger.logError("Block invalid: multiple fee capture transactions in block",
            {message: "", err: ""});
          console.log("Block invalid: multiple fee capture transactions in block");
          return 0;
        } else {
          tmpftfound = 1;
        }
      }

      // we can have multiple golden ticket-tagged sources in the block, but the BID/SID/TID will differ
      let as_indexer = "a"+tmpbid+"-"+tmptid+"-"+tmpsid+"-"+tmpgt;
      if (spent_inputs[as_indexer] == 1) {
        // LOG INFO
        this.app.logger.logError("Block invalid: multiple transactions spend same input: "+tmpbid+"/"+tmptid+"/"+tmpsid+"/"+tmpgt,
            {message: "", err: ""});
        console.log("Block invalid: multiple transactions spend same input: "+tmpbid+"/"+tmptid+"/"+tmpsid+"/"+tmpgt);
        return 0;
      }
      spent_inputs[as_indexer] = 1;
    }
  }
  spent_inputs = null;


  //////////////////////
  // validate locally //
  //////////////////////
  //
  // this is a different validation function than used to check
  // transactions we add to our mempool.
  //
  // the reason for this is that mempool transactions are not in our
  // hashmap (no block hash, etc.) and if we generated them locally
  // as part of Golden Tickets they will not have BID or BHASH set.
  //
  // in this case we can assume that all blocks have BID and BHASH
  // information.
  //
  for (let b = 0; b < newblock.transactions.length; b++) {
    for (let bb = 0; bb < newblock.transactions[b].transaction.from.length; bb++) {
      if (newblock.transactions[b].transaction.from[bb].amt > 0) {
        let utxi = newblock.transactions[b].transaction.from[bb];
        let slip_map_index = storage_self.returnHashmapIndex(utxi.bid, utxi.tid, utxi.sid, utxi.add, utxi.amt, utxi.bhash);

        //
        // if we fail to validate the slip, we will permit it if
        // we do not have a full genesis period worth of blocks
        // as while this may lead us onto a poisoned chain, there
        // is no way to be sure until we have a full genesis block
        //
        // if this becomes a problem in practice, then we need to
        // maintain block hash records stretching back to the genesis
        // block, which will be unfortunate but allow a workaround
        // in the event of real issues here.
        //
        if (shashmap.validate_slip(slip_map_index, newblock.block.id) == 0) {

          if (newblock.transactions[b].transaction.from[bb].bid < storage_self.app.blockchain.blk_limit) {

            //
            // we cannot be sure that we should be rejecting this block
            // unless we have a full genesis period, as only with a full
            // genesis period of blocks can we be sure that the inputs
            // are coming from a valid chain.
            //
            // the solution to the problem posed by this is to confirm
            // that the fork_id for the chain is correct once it has
            // been downloaded, or start the sync from a known-good
            // block provided by a trusted source (i.e. software provider)
            //

            // LOG INFO
            storage_self.app.logger.logError("Validation Failure, but acceptable as we do not have a full genesis period yet",
              {message: "", err: ""});
            console.log("Validation Failure, but acceptable as we do not have a full genesis period yet");

          } else {

            //
            // while we are debugging, we stop execution here for
            // the purpose of assisting with debugging. Once we are
            // ready for production we can shift this to just return
            // 0 and it will trigger a rewinding / resetting of the
            // chain to a formerly good position.

            // LOG INFO
            console.log("FAILED TO VALIDATE SLIP: " + slip_map_index);
            console.log(JSON.stringify(newblock.transactions[b].transaction.from[bb], null, 4));
            console.log("MY GBID: " + storage_self.app.blockchain.blk_limit);

            storage_self.app.logger.logInfo(`FAILED TO VALIDATE SLIP: ${slip_map_index}`);
            storage_self.app.logger.logInfo(JSON.stringify(newblock.transactions[b].transaction.from[bb], null, 4));
            storage_self.app.logger.logInfo(`MY GBID: ${storage_self.app.blockchain.blk_limit}`);

            return 0;
          }
        }
      }
    }
  }


  //
  // now handle prevblock issues like monetary policy, etc.
  //
  if (prevblk == null) {
    if (storage_self.app.blockchain.index.length > 0 && prevblk_permitted_null == 0) {
      return 0;
    } else {
      return 1;
    }
  } else {

    //
    // golden ticket
    //
    if (! newblock.validateGoldenTicket(prevblk) ) {
      console.log("Block does not validate -- Golden Ticket Wrong!!!");
      storage_self.app.logger.logError("Block does not validate -- Golden Ticket Wrong!!!",
        {message:"", error:""});
      return 0;
    }

    //
    // burn fee and fee step
    //
    var newbf = newblock.calculateBurnFee(prevblk.returnBurnFee(), prevblk.returnFeeStep());
    if (newbf[0] != newblock.block.burn_fee) {
      console.log("Block invalid: burn fee miscalculated: "+newbf[0]+" versus "+newblock.block.burn_fee);
      storage_self.app.logger.logError("Block invalid: burn fee miscalculated: "+newbf[0]+" versus "+newblock.block.burn_fee,
        {message:"", error:""});
      return;
    }
    if (newbf[1] != newblock.block.fee_step) {
      console.log("Block invalid: fee step miscalculated: "+newbf[1]+" versus "+newblock.block.fee_step);
      storage_self.app.logger.logError("Block invalid: fee step miscalculated: "+newbf[1]+" versus "+newblock.block.fee_step,
        {message:"", error:""});
      return 0;
    }

  }

  // block w/o transactions also valid
  return 1;
}


//////////////////////////
// validateLongestChain //
//////////////////////////
//
// This is called at the end of addBlockToBlockchain in the
// blockchain class. It starts the process of unrolling the
// existing chain and rolling out the new longest chain,
// validating the transaction slips to confirm that hte new
// chain is valid.
//
// If there is a problem validating the new proposed longest
// chain, the software must unroll any new blocks it has
// added and re-roll out the existing chain.
//
// @params {saito.block} newest block
// @params {interger} newest block index in blockchain.index
// @params {integer} block index of last-common-ancestor blockchain.index
// @params {array} array of block indexes for new blocks becoming longest chain
// @params {array} array of block hashes for new blocks becoming longest chain
// @params {array} array of block_ids for new blocks becoming longest chain
// @params {array} array of block indexes for existing blocks losing longest chain
// @params {array} array of block hashes for existing blocks losing longest chain
// @params {array} array of block_ids for existing blocks losing longest chain
// @params {integer} is newest block longest chain (should be 1)
// @params {string} "force" if block is loaded from disk
//
Storage.prototype.validateLongestChain = function validateLongestChain(newblock, pos, shared_ancestor_index_pos, new_block_idxs, new_block_hashes, new_block_ids, old_block_idxs, old_block_hashes, old_block_ids, i_am_the_longest_chain, forceAdd) {

  var storage_self = this;

  console.log("validating longest chain");

  //
  // lite-client validation goes here. We really only care about the integrity of
  // the transactions we are monitoring, so we do not check the whole chain. In the
  // future we should do merkle-root checks and put them here. As long as the
  // general block data has been OK we just assume the transaction slips are OK since
  // we cannot verify them.
  //
  if (this.app.BROWSER == 1 || this.app.SPVMODE == 1) {

    //
    // we have to trust that the transaction slips are valid as we are not
    // a full-node. In the future this can be replaced with merkle roots
    // etc. so that we can at least confirm our own transactions are valid
    //
    for (let x = 0; x < old_block_ids.length; x++) {
      storage_self.app.storage.onChainReorganization(old_block_ids[x], old_block_hashes[x], 0);
      storage_self.app.wallet.onChainReorganization(old_block_ids[x], old_block_hashes[x], 0);
      storage_self.app.modules.onChainReorganization(old_block_ids[x], old_block_hashes[x], 0);
      storage_self.app.blockchain.index.lc[old_block_idxs[x]] = 0;
    }

    //
    // -1 as we handle the current block in addBlockToBlockchainPartTwo
    //
    for (let x = 0; x < new_block_ids.length-1; x++) {
      storage_self.app.storage.onChainReorganization(new_block_ids[x], new_block_hashes[x], 1);
      storage_self.app.wallet.onChainReorganization(new_block_ids[x], new_block_hashes[x], 1);
      storage_self.app.modules.onChainReorganization(new_block_ids[x], new_block_hashes[x], 1);
      storage_self.app.blockchain.index.lc[new_block_idxs[x]] = 1;
    }

    storage_self.app.blockchain.addBlockToBlockchainPartTwo(newblock, pos, i_am_the_longest_chain, forceAdd);
    return;

  }

  //
  // unwind or wind
  //
  if (old_block_hashes.length > 0) {
    storage_self.unwindChain(newblock, pos, shared_ancestor_index_pos, new_block_idxs, new_block_hashes, new_block_ids, old_block_idxs, old_block_hashes, old_block_ids, i_am_the_longest_chain, forceAdd, old_block_hashes.length-1, 0);
  } else {
    storage_self.windChain(newblock, pos, shared_ancestor_index_pos, new_block_idxs, new_block_hashes, new_block_ids, old_block_idxs, old_block_hashes, old_block_ids, i_am_the_longest_chain, forceAdd, 0, 0);
  }
}


/////////////////////////////////////////
// validateTransactionInputsForMempool //
/////////////////////////////////////////
//
// This is called by the mempool when it receives a transaction
// over the network. We validate that the inputs are valid before
// we add it to our mempool so that we don't end up producing an
// invalid block.
//
// @params {saito.transaction} transaction to check
// @params {callback} callback on success
//
Storage.prototype.validateTransactionInputsForMempool = function validateTransactionInputsForMempool(tx, mycallback) {

  if (this.app.BROWSER == 1 || this.app.SPVMODE == 1) { mycallback(this.app, tx); return; }

  var storage_self = this;
  let utxiarray = tx.transaction.from;
  let gtnum = 0;
  let map_found = 0;

  for (let via = 0; via < utxiarray.length; via++) {

    let utxi  = utxiarray[via];

     ////////////////////////
     // validate 0-payment //
     ////////////////////////
     if (utxi.amt == 0) {
        map_found++;
     } else {

       if (utxi.amt == 0 && utxi.bid == 0 && utxi.tid == 0 && utxi.sid == 0 && (utxi.gt == 1 || utxi.ft == 1)) { gtnum++; } else {

         //////////////////////
         // validate hashmap //
         //////////////////////
         let slip_map_index = this.returnHashmapIndex(utxi.bid, utxi.tid, utxi.sid, utxi.add, utxi.amt, utxi.bhash);
         if (shashmap.validate_slip(slip_map_index, storage_self.app.blockchain.returnLatestBlockId()) == 1) {
           map_found++;
         }
       }
     }
   }

  if (gtnum == utxiarray.length) { mycallback(this.app, tx); return; }
  if (gtnum+map_found >= utxiarray.length) { mycallback(this.app, tx); return; }
  return;
}


///////////////
// windChain //
///////////////
//
// this rolls out the new longest chain and validates that the
// transaction inputs are all from spendable addresses.
//
// if we run into problems rolling out the new chain, we unroll it
// and roll the old chain back out again, remembering to set the
// resetting_flag to 1 so that we can report back that the chain
// reorganization attempt failed once we are done.
//
// once all of the new blocks are rolled out, we send control back
// to the blockchain class to finish either rolling out the new
// block or to reset the chain condition so that it is ready to
// process the next block.
//
// addBlockToBlockchainPartTwo --> on success
// addBlockToBlockchainFailure --> on failure
//
// @params {saito.block} newest block
// @params {interger} newest block index in blockchain.index
// @params {integer} block index of last-common-ancestor blockchain.index
// @params {array} array of block indexes for new blocks becoming longest chain
// @params {array} array of block hashes for new blocks becoming longest chain
// @params {array} array of block_ids for new blocks becoming longest chain
// @params {array} array of block indexes for existing blocks losing longest chain
// @params {array} array of block hashes for existing blocks losing longest chain
// @params {array} array of block_ids for existing blocks losing longest chain
// @params {integer} is newest block longest chain (should be 1)
// @params {string} "force" if block is loaded from disk
// @params {integer} position in above old_block_* arrays of this block
// @params {integer} 1 if we are unwinding a bad new chain
//
Storage.prototype.windChain = function windChain(newblock, pos, shared_ancestor_index_pos, new_block_idxs, new_block_hashes, new_block_ids, old_block_idxs, old_block_hashes, old_block_ids, i_am_the_longest_chain, forceAdd, current_wind_index, resetting_flag) {

  var storage_self = this;

  let this_block_hash = new_block_hashes[current_wind_index];

  //
  // we have not saved the latest block to disk yet, so
  // there's no need to go through the delay of opening
  // files from disk and needing a callback.
  //
  if (this_block_hash == newblock.returnHash()) {

    storage_self.app.blockchain.returnBlockByHash(newblock.block.prevhash, function(prevblk) {

      if (storage_self.validateBlockInputs(newblock, prevblk) == 1) {

        //
        // we do not handle onChainReorganization for everything
        // here as we do for older blocks. the reason for this is
        // that the block is not yet saved to disk.
        //
        // we handle the latest block differently here as this
        // avoids our saving to disk blocks that do not validate
        // and stuffing out hard drive and database with spam
        //
        storage_self.spendBlockInputs(newblock);
        storage_self.app.blockchain.addBlockToBlockchainPartTwo(newblock, pos, i_am_the_longest_chain, forceAdd);

      } else {

        if (current_wind_index == 0) {

          // this is the first block we have tried to add
          // and so we can just roll out the older chain
          // again as it is known good.
          //
          // note that old and new hashes are swapped
          // and the old chain is set as null because
          // we won't move back to it. we also set the
          // resetting_flag to 1 so we know to fork
          // into addBlockToBlockchainFailure.
          //
          if (old_block_hashes.length > 0) {
            storage_self.windChain(newblock, pos, shared_ancestor_index_pos, old_block_idxs, old_block_hashes, old_block_ids, null, null, null, i_am_the_longest_chain, forceAdd, 0, 1);
          } else {
            storage_self.app.blockchain.addBlockToBlockchainFailure(newblock, pos, i_am_the_longest_chain, forceAdd);
          }
        } else {

    	    //
          // we need to unwind some of our previously
          // added blocks from the new chain. so we
          // swap our hashes to wind/unwind.
	        //
          var chain_to_unwind_hashes = new_block_hashes.splice(current_wind_index);
          var chain_to_unwind_idxs   = new_block_idxs.splice(current_wind_index);
          var chain_to_unwind_ids    = new_block_ids.splice(current_wind_index);

	        //
          // unwind NEW and wind OLD
          //
          // note that we are setting the resetting_flag to 1
          //
          storage_self.unwindChain(newblock, pos, shared_ancestor_index_pos, old_block_idxs, old_block_hashes, old_block_ids, chain_to_unwind_idxs, chain_to_unwind_hashes, chain_to_unwind_ids, i_am_the_longest_chain, forceAdd, chain_to_unwind_hashes.length, 1);

        }
      }
    });


  //
  // this is not the latest block, so we need to
  // fetch it from disk, and then do exactly the
  // same thing as above, essentially.
  //
  } else {

    storage_self.app.blockchain.returnBlockByHash(new_block_hashes[current_wind_index], function(blk) {
      storage_self.app.blockchain.returnBlockByHash(blk.block.prevhash, function(prevblk) {

        if (blk == null) {
          console.log("Cannot open block that should exist in windChain");
          storage_self.app.logger.logError("Cannot open block that should exist in windChain",
            { message: "", error: "" });
          process.exit();
        }

        if (storage_self.validateBlockInputs(blk, prevblk) == 1) {

          storage_self.app.storage.onChainReorganization(blk.block.id, blk.returnHash(), 1);
          storage_self.app.wallet.onChainReorganization(blk.block.id, blk.returnHash(), 1);
          storage_self.app.modules.onChainReorganization(blk.block.id, blk.returnHash(), 1);
          storage_self.app.blockchain.index.lc[new_block_idxs[current_wind_index]] = 1;

          storage_self.spendBlockInputs(blk);

          if (current_wind_index == new_block_idxs.length-1) {
            if (resetting_flag == 0) {
              storage_self.app.blockchain.addBlockToBlockchainPartTwo(newblock, pos, i_am_the_longest_chain, forceAdd);
            } else {
              storage_self.app.blockchain.addBlockToBlockchainFailure(newblock, pos, i_am_the_longest_chain, forceAdd);
            }
          } else {
            storage_self.windChain(newblock, pos, shared_ancestor_index_pos, new_block_idxs, new_block_hashes, new_block_ids, old_block_idxs, old_block_hashes, old_block_ids, i_am_the_longest_chain, forceAdd, current_wind_index+1, resetting_flag);
            return;
          }

          storage_self.app.blockchain.addBlockToBlockchainPartTwo(newblock, pos, i_am_the_longest_chain, forceAdd);

        } else {

          if (current_wind_index == 0) {
            storage_self.windChain(newblock, pos, shared_ancestor_index_pos, old_block_idxs, old_block_hashes, old_block_ids, null, null, null, i_am_the_longest_chain, forceAdd, 0, 1);
          } else {
            var chain_to_unwind_hashes = new_block_hashes.splice(current_wind_index);
            var chain_to_unwind_idxs   = new_block_idxs.splice(current_wind_index);
            var chain_to_unwind_ids    = new_block_ids.splice(current_wind_index);
            storage_self.unwindChain(newblock, pos, shared_ancestor_index_pos, old_block_idxs, old_block_hashes, old_block_ids, chain_to_unwind_idxs, chain_to_unwind_hashes, chain_to_unwind_ids, i_am_the_longest_chain, forceAdd, chain_to_unwind_hashes.length, 1);
          }
        }
      });
    });
  }

}
