const saito = require('../../../saito');
const ModTemplate = require('../../template');
const util = require('util');


//////////////////
// CONSTRUCTOR  //
//////////////////
function Archive(app) {

  if (!(this instanceof Archive)) { return new Archive(app); }

  Archive.super_.call(this);

  this.app             = app;

  this.name            = "Archive";
  this.browser_active  = 0;

  this.host            = "localhost"; // hardcoded
  this.port            = "12100";     // hardcoded
  this.publickey       = "";          // hardcoded

  return this;

}
module.exports = Archive;
util.inherits(Archive, ModTemplate);



////////////////
// Initialize //
////////////////
//
// load our publickey
//
Archive.prototype.initialize = function initialize() {
  this.publickey = this.app.wallet.returnPublicKey();
}


////////////////////
// Install Module //
////////////////////
//
// create one table to manage authorized users, and another
// table to store the transactions.
//
Archive.prototype.installModule = function installModule() {

  if (this.app.BROWSER == 1) { return; }

  sql = "\
        CREATE TABLE IF NOT EXISTS mod_archive (\
                id INTEGER, \
                publickey TEXT, \
                tx TEXT, \
                txsig TEXT, \
                permission INTEGER, \
                authorized_keys TEXT, \
                block_id INTEGER, \
                unixtime INTEGER, \
                PRIMARY KEY(id ASC) \
        )";
  this.app.storage.execDatabase(sql, {}, function() {});

  sql = "\
        CREATE TABLE IF NOT EXISTS mod_archive_users (\
                id INTEGER, \
                publickey TEXT, \
                active INTEGER, \
                PRIMARY KEY(id ASC) \
        )";
  this.app.storage.execDatabase(sql, {}, function() {});

}






/////////////////////////
// Handle Web Requests //
/////////////////////////
Archive.prototype.webServer = function webServer(app, expressapp) {

  var archive_self = this;

  expressapp.get('/archive/txs/:txsig', function (req, res) {

    if (req.params.txsig == null) { return; }

    var txsig = req.params.txsig;

    var sql = "SELECT * FROM mod_archives WHERE txsig LIKE BINARY $txsig";
    var params = { $txsig : txsig };
    archive_self.app.storage.execDatabase(sql, params, function(err, row) {
      if (err != null) {

        res.setHeader('Content-type', 'text/html');
        res.charset = 'UTF-8';
        res.write("Error Locating Transaction");
        res.end();
        return;

      }

      if (row != null) {

        res.setHeader('Content-type', 'text/html');
        res.charset = 'UTF-8';
        res.write("Transaction Located");
        res.end();
        return;

      } else {

        res.setHeader('Content-type', 'text/html');
        res.charset = 'UTF-8';
        res.write("No Transaction Found");
        res.end();
        return;

      }
    });
  });

  expressapp.get('/archive/', function (req, res) {
    res.sendFile(__dirname + '/web/index.html');
    return;
  });

  expressapp.get('/archive/style.css', function (req, res) {
    res.sendFile(__dirname + '/web/style.css');
    return;
  });

}





//////////////////////////
// Handle Peer Requests //
//////////////////////////
Archive.prototype.handlePeerRequest = function handlePeerRequest(app, message, peer, mycallback) {

    //////////////////
    // archive load // 
    //////////////////
    if (message.request == "archive load") {

console.log("loading request inbound: ");
console.log(JSON.stringify(message));

      starting_at       = message.data.starting_at;
      number_of_entries = message.data.number;
      publickey = message.data.publickey;
      sql    = "SELECT * FROM mod_archive WHERE publickey = $publickey LIMIT $number_of_entries OFFSET $starting_at";
      params = { $publickey : publickey, $number_of_entries : number_of_entries, $starting_at : starting_at } 
      app.storage.queryDatabaseArray(sql, params, function(err, rows) {
        if (rows != null) {
	  for (mat = 0; mat < rows.length; mat++) {
	    message                 = {};
	    message.request         = "archive send";
	    message.data            = {};
	    message.data.tx         = rows[mat].tx;
	    message.data.block_id   = rows[mat].block_id;
	    message.data.unixtime   = rows[mat].unixtime;
            peer.sendRequest(message.request, message.data);
          }
        }
      });
    }


    ////////////////////
    // archive delete //
    ////////////////////
    if (message.request == "archive delete") {
      txid      = message.data.txid;
      txts      = message.data.txts;
      publickey = message.data.publickey;
      sql    = "SELECT * FROM mod_archive WHERE publickey = $publickey AND unixtime = $unixtime";
      params = { $publickey : publickey, $unixtime : txts };
      app.storage.queryDatabaseArray(sql, params, function(err, rows) {
        if (rows != null) {
	  for (mat = 0; mat < rows.length; mat++) {
	    tmptx = new saito.transaction(rows[mat].tx);
	    if (tmptx.transaction.id == txid) {
              sql = "DELETE FROM mod_archive WHERE publickey = $publickey AND unixtime = $unixtime AND tx = $ourtx";
      	      params = { $publickey : publickey, $unixtime : txts, $ourtx : rows[mat].tx};
      	      app.storage.execDatabase(sql, params, function() {});
	    }
          }
        }
      });
    }


    ///////////////////
    // archive reset //
    ///////////////////
    if (message.request == "archive reset") {
      publickey = message.data.publickey;
      sql = "DELETE FROM mod_archive WHERE publickey = $publickey";
      params = { $publickey : publickey };
      app.storage.execDatabase(sql, params, function() {});
    }


    //////////////////
    // archive send // 
    //////////////////
    if (message.request == "archive send") {

      tx       = message.data.tx;
      block_id = message.data.block_id;
      unixtime = message.data.unixtime;

      newtx = new saito.transaction(tx);
      this.app.modules.loadFromArchives(newtx);

    }


    //////////////////
    // archive save //
    //////////////////
    if (message.request == "archive save") {

console.log("Attempting to Save in Archives");
console.log(JSON.stringify(message.data, null, 4));

      //
      // check validity of message
      //
      // FIX
      //
      // check we are authorized to archive data
      // 
      sql = "SELECT count(*) AS count FROM mod_archive_users WHERE publickey = $publickey AND active = 1";
      params = { $publickey : message.data.publickey };
      peer.app.storage.queryDatabase(sql, params, function (err, row) {
        if (row != null) {
          if (row.count > 0) {
            sql = "INSERT OR IGNORE INTO mod_archive (publickey, tx, txsig, permission, authorized_keys, block_id, unixtime) VALUES ($publickey, $tx, $txsig, $permission, $authorized_keys, $block_id, $unixtime)";
            app.storage.db.run(sql, {
              $publickey: message.data.publickey,
              $tx: message.data.tx,
              $txsig: message.data.txsig,
              $permission: message.data.permission,
              $authorized_keys: message.data.authorized_keys,
              $block_id: message.data.block_id,
              $unixtime: message.data.unixtime
            });
          }
        }
      });
    }


}








