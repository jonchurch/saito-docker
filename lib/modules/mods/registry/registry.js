var saito = require('../../../saito');
var ModTemplate = require('../../template');
var util = require('util');
var fs          = require('fs');
var request = require("request");











//////////////////
// CONSTRUCTOR  //
//////////////////
function Registry(app) {

  if (!(this instanceof Registry)) { return new Registry(app); }

  Registry.super_.call(this);

  this.app             = app;

  // separate database
  this.db              = null;

  this.name            = "Registry";
  this.browser_active  = 0;
  this.handlesEmail    = 1;
  this.handlesDNS      = 1;
  this.emailAppName    = "Register Address";

  this.domain          = "saito";
  this.host            = "localhost"; // hardcoded
  this.port            = "12101";     // hardcoded
  this.publickey       = "nR2ecdN7cW91nxVaDR4uXqW35GbAdGU5abzPJ9PkE8Mn";

  return this;

}
module.exports = Registry;
util.inherits(Registry, ModTemplate);




////////////////////
// Install Module //
////////////////////
Registry.prototype.installModule = function installModule() {

  var registry_self = this;

  if (registry_self.app.BROWSER == 1 || registry_self.app.SPVMODE == 1) { return; }

  var sqlite3 = require('sqlite3').verbose();
  registry_self.db = new sqlite3.Database('./data/registry.sq3');

  sql = "\
        CREATE TABLE IF NOT EXISTS mod_registry_addresses (\
                id INTEGER, \
                identifier TEXT, \
                publickey TEXT, \
                unixtime INTEGER, \
                block_id INTEGER, \
                block_hash TEXT, \
                signature TEXT, \
                signer TEXT, \
                longest_chain INTEGER, \
		UNIQUE (identifier), \
                PRIMARY KEY(id ASC) \
        )";


  registry_self.db.run(sql, {}, function() {

    //
    // if we are not the main server but we are running
    // the registry module, we want to be able to track
    // DNS requests, which means running our own copy
    // of the database.
    //
    if (registry_self.app.wallet.returnPublicKey() != registry_self.publickey) {


      console.log("//");
      console.log("// FETCHING DNS INFORMATION");
      console.log("// ");

      //
      // figure out where to get our master data
      //
      // we only get it from the master server if we do not have
      // another DNS server configured as an intermediary
      //
      var master_url = "http://" + registry_self.domain + ":" + registry_self.port + "/registry/addresses.txt";
//      for (let i = 0; i < registry_self.app.options.dns; i++) {
//	  if (registry_self.app.options.dns[i].domain == registry_self.domain) {
//          if (registry_self.app.options.server != null) {
//            if (registry_self.app.options.dns[i].host != registery_self.app.options.server.host) {
//              master_url = "http://" + registry_self.app.options.dns[i].host + "::" + registry_self.app.options.dns[i].port + "/registry/addresses.txt";
//              i = registry_self.app.options.dns.length+1;
//            }
//          }
//        }
//      }


      //
      // fetch the latest DNS data from our server
      //
      try {
        request.get(master_url, (error, response, body) => {

	  if (body != null) {
            var lines = body.split("\n");

            for (var m = 0; m < lines.length; m++) {

	      var write_to_file = lines[m] + "\n";
              var line = lines[m].split("\t");

	      if (line.length != 7) {} else {

	        var identifier = line[0];
		var block_id   = line[1];
		var block_hash = line[2];
		var address    = line[3];
		var unixtime   = line[4];
		var sig        = line[5];
		var signer     = line[6];


		if (signer != registry_self.publickey) {} else {

	     	  var msgtosign   = identifier + address + block_id + block_hash;
	    	  var msgverifies = registry_self.app.crypt.verifyMessage(msgtosign, sig, signer);

		  if (msgverifies == true) {
		    var sql = "INSERT OR IGNORE INTO mod_registry_addresses (identifier, publickey, unixtime, block_id, block_hash, signature, signer, longest_chain) VALUES ($identifier, $publickey, $unixtime, $block_id, $block_hash, $sig, $signer, $longest_chain)";
		    var params = {
		      $identifier : identifier,
		      $publickey : address,
		      $unixtime : unixtime,
		      $block_id : block_id,
		      $block_hash : block_hash,
		      $sig : sig,
	              $signer : signer,
		      $longest_chain : 1
		    }
                    fs.appendFileSync((__dirname + "/web/addresses.txt"), write_to_file, function(err) { if (err) { }; });
	            registry_self.db.run(sql, params, function(err) {});
		  }
		}
  	      }
            }
          }
        });
      } catch (err) {}
    }
  });

}



////////////////
// Initialize //
////////////////
Registry.prototype.initialize = function initialize() {

  if (this.app.BROWSER == 1) { return; }

  var registry_self = this;

  if (this.db == null) {
    var sqlite3 = require('sqlite3').verbose();
    registry_self.db = new sqlite3.Database('./data/registry.sq3');
  }

}











/////////////////////////
// Handle Web Requests //
/////////////////////////
Registry.prototype.webServer = function webServer(app, expressapp) {

  expressapp.get('/registry/', function (req, res) {
    res.sendFile(__dirname + '/web/index.html');
    return;
  });
  expressapp.get('/registry/style.css', function (req, res) {
    res.sendFile(__dirname + '/web/style.css');
    return;
  });

  // sql
  expressapp.get('/registry/addresses.txt', function (req, res) {
    res.sendFile(__dirname + '/web/addresses.txt');
    return;
  });

}






////////////////////////////////
// Email Client Interactivity //
////////////////////////////////
Registry.prototype.displayEmailForm = function displayEmailForm(app) {

  element_to_edit = $('#module_editable_space');

  element_to_edit_html = '<div id="module_instructions" class="module_instructions">Register a human-readable email address:<p></p><input type="text" class="module_textinput" id="module_textinput" value="" /><div class="module_textinput_details">@'+this.domain+'</div><p style="clear:both;margin-top:0px;"> </p>ASCII characters only, e.g.: yourname@'+this.domain+', etc. <p></p><div id="module_textinput_button" class="module_textinput_button" style="margin-left:0px;margin-right:0px;">register</div></div>';
  element_to_edit.html(element_to_edit_html);

  $('#module_textinput').off();
  $('#module_textinput').on('keypress', function(e) {
    if (e.which == 13 || e.keyCode == 13) {
      $('#module_textinput_button').click();
    }
  });




  $('#module_textinput_button').off();
  $('#module_textinput_button').on('click', function() {
    var identifier_to_check = $('module_textinput').val();
    var regex=/^[0-9A-Za-z]+$/;
    if (regex.test(identifier_to_check)) {
      $('#send').click();
    } else {
      alert("Only Alphanumeric Characters Permitted");
    }
  });


  // auto-input correct address and payment amount
  $('#lightbox_compose_to_address').val(this.publickey);
  $('#lightbox_compose_payment').val(3);
  $('#lightbox_compose_fee').val(app.wallet.returnDefaultFee());
  $('.lightbox_compose_address_area').hide();
  $('.lightbox_compose_module').hide();
  $('#module_textinput').focus();

}
/////////////////////
// Display Message //
/////////////////////
Registry.prototype.displayEmailMessage = function displayEmailMessage(message_id, app) {

  if (app.BROWSER == 1) {

    message_text_selector = "#" + message_id + " > .data";
    $('#lightbox_message_text').html( $(message_text_selector).html() );
    $('#lightbox_compose_to_address').val(registry_self.publickey);
    $('#lightbox_compose_payment').val(3);
    $('#lightbox_compose_fee').val(app.wallet.returnDefaultFee());

  }

}
////////////////////////
// Format Transaction //
////////////////////////
Registry.prototype.formatEmailTransaction = function formatEmailTransaction(tx, app) {
  tx.transaction.msg.module = this.name;
  tx.transaction.msg.requested_identifier  = $('#module_textinput').val().toLowerCase();
  return tx;
}









//////////////////
// Confirmation //
//////////////////
Registry.prototype.onConfirmation = function onConfirmation(blk, tx, conf, app) {

  var registry_self = app.modules.returnModule("Registry");

  // browsers check to see if the name has been registered
  // after 1 confirmation, assuming that servers will be
  // processing the request on the zeroth-confirmation
  if (conf == 0) {
    if (app.BROWSER == 1) {

      if (tx.transaction.to[0].add != app.wallet.returnPublicKey()) { return; }

console.log("ADDING REG: " + tx.transaction.to[0].add + " -- " + app.wallet.returnPublicKey());

      full_identifier = tx.transaction.msg.requested_identifier + "@" + app.modules.returnModule("Registry").domain;
      app.dns.fetchPublicKey(full_identifier, function(answer, publickey="") {
        if (answer == app.wallet.returnPublicKey()) {
          app.keys.addKey(app.wallet.returnPublicKey(), full_identifier, 0);
	  app.keys.saveKeys();
	  app.wallet.updateIdentifier(full_identifier);
	}
      });
    }
  }


  /////////////////////////////////
  // NO BROWSERS PAST THIS POINT //
  /////////////////////////////////
  if (app.BROWSER == 1) { return; }

  //
  // only one server will run this function... the registry.
  //
  // anyone else who wants to run it can tweak the function, but should
  // edit the email bit so that we don't auto-send an email to every
  // user who registers from every single server.
  if (tx.transaction.to[0].add != registry_self.publickey) { return; }

  if (conf == 0) {

    // servers-only
    if (tx.transaction.msg != null) {

      full_identifier = tx.transaction.msg.requested_identifier + "@" + app.modules.returnModule("Registry").domain;

      // avoid SQL attack
      if (full_identifier.indexOf("'") > 0) { return; }
      full_identifier = full_identifier.replace(/\s/g, '');

      var tmsql = "SELECT count(*) AS count FROM mod_registry_addresses WHERE identifier = $identifier";
      var params = { $identifier : full_identifier }
      registry_self.db.get(tmsql, params, function(err, row) {
        if (row != null) {
console.log("IN ONCONFIRMATION 2");
          if (row.count == 0) {

	    var msgtosign   = full_identifier + tx.transaction.from[0].add + blk.block.id + blk.returnHash();
	    var registrysig = app.crypt.signMessage(msgtosign, app.wallet.returnPrivateKey());
            var sql = "INSERT OR IGNORE INTO mod_registry_addresses (identifier, publickey, unixtime, block_id, block_hash, signature, signer, longest_chain) VALUES ($identifier, $publickey, $unixtime, $block_id, $block_hash, $sig, $signer, $longest_chain)";
            var params = { $identifier : full_identifier, $publickey : tx.transaction.from[0].add, $unixtime : tx.transaction.ts , $block_id : blk.returnId(), $block_hash : blk.returnHash(), $sig : registrysig , $signer : app.wallet.returnPublicKey(), $longest_chain : 1 };

	    // write SQL to independent file
	    var sqlwrite = full_identifier + "\t" + blk.block.id + "\t" + blk.returnHash() + "\t" + tx.transaction.from[0].add + "\t" + tx.transaction.ts + "\t" + registrysig + "\t" + app.wallet.returnPublicKey() + "\n";
	    fs.appendFileSync((__dirname + "/web/addresses.txt"), sqlwrite, function(err) {
	      if (err) {
	        return console.log(err);
	      }
	    });

console.log("IN ONCONFIRMATION 3");
            registry_self.db.run(sql, params, function() {
console.log("IN ONCONFIRMATION 4");


console.log(tx.transaction.to[0].add + " -- " + registry_self.publickey + " -- " + registry_self.app.wallet.returnPublicKey());
	      // only main signing server needs handle this
              if (tx.transaction.to[0].add == registry_self.publickey && registry_self.publickey == registry_self.app.wallet.returnPublicKey()) {
console.log("IN ONCONFIRMATION 5");

                var to = tx.transaction.from[0].add;
                var from = registry_self.app.wallet.returnPublicKey();
                var amount = 0.0;
                var fee = 2.0;

                server_email_html = 'You can now receive emails (and more!) at this address:<p></p>'+tx.transaction.msg.requested_identifier+'@'+app.modules.returnModule("Registry").domain+'<p></p>To configure your browser to use this address, <div class="register_email_address_success" style="text-decoration:underline;cursor:pointer;display:inline;">please click here</div>.';

                newtx = registry_self.app.wallet.createUnsignedTransactionWithDefaultFee(to, amount);
    	        if (newtx == null) { return; }
                newtx.transaction.msg.module   = "Email";
                newtx.transaction.msg.data     = server_email_html;
                newtx.transaction.msg.title    = "Address Registration Success!";
                newtx.transaction.msg.markdown = 0;
                newtx = registry_self.app.wallet.signTransaction(newtx);

console.log(JSON.stringify(newtx));
                // because we are a server, we add this to our mempool
                // before we send it out. This prevents the transaction
                // from getting rejected if sent back to us and never
                // included in a block if we are the only one handling
                // transactions.
console.log("IN ONCONFIRMATION 6");
                registry_self.app.mempool.addTransaction(newtx);
                registry_self.app.network.propagateTransaction(newtx);
console.log("IN ONCONFIRMATION 7");

	      }
            });

          } else {

            // identifier already registered
            to = tx.transaction.from[0].add;
            from = app.wallet.returnPublicKey();
            amount = 0;
            fee = 2.0;

            server_email_html = full_identifier + ' is already registered';

            newtx = app.wallet.createUnsignedTransactionWithDefaultFee(to, amount);
            if (newtx == null) { return; }
            newtx.transaction.msg.module = "Email";
            newtx.transaction.msg.data   = server_email_html;
            newtx.transaction.msg.title  = "Address Registration Failure!";
            newtx = app.wallet.signTransaction(newtx);

            // servers add to mempool before sending. this avoids loopback failure
            app.mempool.addTransaction(newtx);
            app.network.propagateTransaction(newtx);

          }
        }
      });
    }
  }
}










/////////////////////////
// Handle DNS Requests //
/////////////////////////
//
// this handles zero-free requests sent peer-to-peer across the Saito network
// from hosts to DNS providers.
//
Registry.prototype.handleDomainRequest = function handleDomainRequest(app, message, peer, mycallback) {

  var registry_self = this;

  identifier = message.data.identifier;
  publickey  = message.data.publickey;

  dns_response            = {};
  dns_response.err        = "";
  dns_response.publickey  = "";
  dns_response.identifier = "";


  if (identifier != null) {
    sql = "SELECT * FROM mod_registry_addresses WHERE longest_chain = 1 AND identifier = $identifier";
    params = { $identifier : identifier };
    registry_self.db.get(sql, params, function (err, row) {
      if (row != null) {
        if (row.publickey != null) {
          dns_response.identifier = row.identifier;
          dns_response.publickey  = row.publickey;
          dns_response.unixtime   = row.unixtime;
          dns_response.block_id   = row.block_id;
          dns_response.block_hash = row.block_hash;
          dns_response.signer     = row.signer;
          dns_response.signature  = row.signature;
	  mycallback(JSON.stringify(dns_response));
        }
      } else {
        dns_response.err = "identifier not found";
	mycallback(JSON.stringify(dns_response));
      }
    });
  }

  if (publickey != null) {
    sql = "SELECT * FROM mod_registry_addresses WHERE publickey = $publickey";
    params = { $publickey : publickey };
    registry_self.db.get(sql, params, function (err, row) {
      if (row != null) {
        if (row.publickey != null) {
          dns_response.identifier = row.identifier;
          dns_response.publickey  = row.publickey;
          dns_response.unixtime   = row.unixtime;
          dns_response.block_id   = row.block_id;
          dns_response.block_hash = row.block_hash;
          dns_response.signer     = row.signer;
          dns_response.signature  = row.signature;
          mycallback(JSON.stringify(dns_response));
        }
      } else {
        dns_response.err = "publickey not found";
        mycallback(JSON.stringify(dns_response));
      }
    });
  }

}


Registry.prototype.onChainReorganization  = function onChainReorganization(block_id, block_hash, lc) {

  var registry_self = this;

  //
  // browsers don't have a database tracking this stuff
  //
  if (registry_self.app.BROWSER == 1) { return; }

  if (lc == 0) {
    var sql    = "UPDATE mod_registry_addresses SET longest_chain = 0 WHERE block_id = $block_id AND block_hash = $block_hash";
    var params = { $block_id : block_id , $block_hash : block_hash }
    registry_self.db.run(sql, params, function(err, row) {});
  }

  if (lc == 1) {
    var sql    = "UPDATE mod_registry_addresses SET longest_chain = 1 WHERE block_id = $block_id AND block_hash = $block_hash";
    var params = { $block_id : block_id , $block_hash : block_hash }
    registry_self.db.run(sql, params, function(err, row) {});
  }

}
