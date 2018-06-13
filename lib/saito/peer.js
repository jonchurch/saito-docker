const saito        = require('../saito');
const io           = require('socket.io-client');
const util         = require('util');


/////////////////
// Constructor //
/////////////////
function Peer(app) {

  if (!(this instanceof Peer)) {
    return new Peer(app);
  }

  this.app = app || {};

  this.peer                  = {};
  this.peer.host             = "localhost";
  this.peer.port             = "12101";
  this.peer.publickey        = "";
  this.peer.keylist          = [];		// only used with lite/spv modes
  this.peer.synctype         = "full"; 		// full = full blocks
						// lite = spv client

  if (this.app.SPVMODE == 1) { this.peer.synctype = "lite"; }

  // tracking connection
  this.initializing          = 1;		// 0 - once connection is made
  this.contact	   	         = 0;		// 0 - we initiated contact request
  this.disconnected          = 0;               // 1 - we were disconnected
  this.block_sync            = null;		// id of last block sent in initial sync

  // what do we send
  this.sendblocks            = 1;
  this.sendtransactions      = 1;
  this.sendtickets           = 1;

  // tracking syncing
  this.sync_sending          = 0;
  this.sync_sending_chunk    = 0;
  this.sync_sending_bid      = 0;
  this.sync_latest_bid       = 0;
  this.sync_sending_db_bid   = 0;
  this.sync_timer            = null;
  this.sync_timer_speed      = 800;             // 0.8 seconds

  // queue to prevent flooding
  //
  // note, this is only used for syncing blocks
  // from the blockchain, since having the queue
  // causes issues right now with websocket
  // management otherwise.
  //
  this.message_queue         = [];
  this.message_queue_speed   = 500;             // sent
  this.message_queue_timer   = null;

  // socket
  this.socket                = null;
  this.socket_id             = null;



  //
  // these variables determine if the peer is sending us
  // good blocks or transactions and whether we relay them
  // or protect the rest of the network. a node that always
  // sends good data should not have any problems
  //
  // 1 ==> good
  // -1 ==> bad
  // 0 ==> do not know
  //
  this.last_block_connected       = 0;
  this.last_block_valid           = 0;
  this.last_transaction_valid     = 0;



  //
  // manage blockchain sync queue
  //
  var peer_self = this;
  this.message_queue_timer = setInterval(function() {
    if (peer_self.message_queue.length > 0) {
      if (peer_self.socket != null) {
        if (peer_self.socket.connected == true) {
          peer_self.socket.emit('request',peer_self.message_queue[0]);
          peer_self.message_queue.splice(0, 1);
        }
      }
    }
  }, this.message_queue_speed);


  return this;

}
module.exports = Peer;


//
// NOTE TO DEVELOPERS:
//
// This is a harder class to understand, because the same code
// needs to handle interactions on both sides: the node that
// is originating a connection and the node that is receiving
// the connection.
//
// The general structure is that the node that wants to 
// initiate the connection will create a peer object and update
// it with the relevant information (host, post, etc.) and then
// call the function:
//
//   connect
//
// This will format a JS request and send it to the remote 
// server through a websocket it will open. The remote server
// will create a REPLY message and send it back to this server.
// Both machines will automatically start syncing blocks to 
// each other depending on where they are in the chain.
//
// Once the connection has been established, the most important
// function from a development perspective is:
//
//   addSocketEvents
//
// As this is where the code is written that specifies what 
// we do with the requests that we receive over the network
// once a connection is established.
//


/////////////////////
// addSocketEvents //
/////////////////////
//
// After we connect to a remote node, we add events to the 
// socket. This function creates those events, which fire
// on connection / disconnection and whenever we receive 
// data from the remote node.
//
// This is the HEART of the peer class. All of the important
// behavior is defined in this function.
//
Peer.prototype.addSocketEvents = function addSocketEvents() {

  var peer_self = this;

  //
  // we wrap this whole thing in a try / catch error
  // clause so that problems don't crash our server
  //
  try {

    /////////////
    // decrypt //
    /////////////
    //
    // TODO
    //
    // handle default encryption for nodes with
    // a shared secret. Need to be careful that
    // we actually intend for this to be encrypted
    //


    /////////////
    // connect //
    /////////////
    this.socket.on('connect', function(){
      this.initializing = 0;
      console.log("client connect");
      if (peer_self.contact == 0) {
        if (peer_self.disconnected == 1) {
          peer_self.socket.emit('request',JSON.stringify(peer_self.returnConnectMessage()));
        }
      }
    });


    ////////////////
    // disconnect //
    ////////////////
    this.socket.on('disconnect', function(){
      console.log("client disconnect");
      peer_self.disconnected = 1;
    });

    this.socket.on('event', function(){});

    //////////////////
    // other events //
    //////////////////

    this.socket.on('request', function (data, mycallback=null) {

      let response = {}

      let message = JSON.parse(data.toString());

      /////////////////////
      // module callback //
      /////////////////////
      peer_self.app.modules.handlePeerRequest(message, peer_self, mycallback);

      /////////////
      // connect //
      /////////////
      //
      // inbound connection request
      //
      // we fetch the data the other node tells us about itself
      // and start sending it blocks depending on its state of
      // sync with our blockchain
      //
      if (message.request == "connect") {

        peer_self.contact           = 1; // i received connect request
        peer_self.disconnected      = 0;
        peer_self.sendblocks        = message.data.sendblocks;
        peer_self.sendtransactions  = message.data.sendtransactions;
        peer_self.sendtickets       = message.data.sendtickets;

        peer_self.peer.publickey    = message.data.publickey;
        peer_self.peer.keylist      = message.data.keylist;
        peer_self.peer.synctype     = message.data.synctype;

        let peer_reindexing         = message.data.reindexing;
        let my_last_block           = peer_self.app.blockchain.returnLatestBlock();
        let my_last_bid             = 0;
        let peer_last_bid  	        = message.data.lastblock;
        let peer_fid       	        = message.data.forkid;


        //
        // update port and host info
        //
        if (message.data.host != "") {
          peer_self.peer.host       = message.data.host;
        }
        if (message.data.port != "") {
          peer_self.peer.port       = message.data.port;
        }


        console.log("SETTING PEER TO: ");
        console.log(JSON.stringify(peer_self.peer));



        //
        // if we are reindexing from disk, do not ask for updates
        //
        if (peer_reindexing == 1) {
          return;
        }

        if (peer_self.app.storage.currently_reindexing == 1) {
          return;
        }

        //
        // update our last block_id based on what our blockchain tells us
        //
        // this cannot be handled above as my_last_block may be null on a new chain
        //
        if (my_last_block != null) { my_last_bid = my_last_block.returnId(); }

        //
        // if the remote peer included a peer_last_bid (their last block_id) then
        // we can use that in conjunction with the peer_fid (their fork_id) to figure
        // out our last shared block and send them everything after that.
        //
        // using this method to find the proper syncing point prevents an edge-case
        // wherein our remote node has produced a block on its own and only asks us 
        // for blocks FOLLOWING it, while we have no knowledge of that block as we
        // are on the proper chain.
	      //
        let bid_from_fid = peer_self.app.blockchain.returnLastSharedBlockId(peer_fid, peer_last_bid);
        if (bid_from_fid < peer_last_bid) {
          if (peer_self.peer.synctype == "full") {
	          peer_last_bid = bid_from_fid;
          }
        }

	      //
        // if a lite-client tells us they want everything from scratch, we don't 
        // believe them and reset the peer_last_bid to nothing so that we will 
        // only sync them the latest blocks needed to get them started.
        //
        if (peer_last_bid == 0 && peer_self.peer.synctype == "lite") {
          peer_last_bid = "";
        }

	      ////////////////
        // lite-nodes //
	      ////////////////
        if (peer_self.peer.synctype == "lite") {

	      //
        // lite-nodes get the last 10 blocks if they
	      // tell us they want to sync from scratch
	      //
          if (peer_last_bid === "" || peer_last_bid == 0) {
            let start_bid = my_last_bid-10;
            if (start_bid < 0) { start_bid = 0; }
            peer_self.sendBlockchain(start_bid, peer_self.peer.synctype);

          //
          // but if they give us a real number, we give
          // them the blocks since that time
          //
          // TODO:
          //
          // what if the lite-node wants to sync from a
          // point that is no-longer part of the chain
          // because it has fallen off the end? in that
          // case we should notify them....
          //
          } else {
            peer_self.sendBlockchain(peer_last_bid, peer_self.peer.synctype);
          }

        ////////////////
        // full-nodes //
        ////////////////
        } else {

          //
          // sync from scratch
          //
          if (peer_last_bid === "" || peer_last_bid == 0) {
            peer_self.sendBlockchain(0, peer_self.peer.synctype);

          //
          // or from their last contact point
          //
          // TODO
          //
          // what if a full-node wants to sync from a point 
          // that is too far back in the transient chain 
          // for us to handle? we should notify them.
          //
          } else {
              peer_self.sendBlockchain(peer_last_bid, peer_self.peer.synctype);
          }
        }
      return;
    }


    ///////////////////////
    // denied connection //
    ///////////////////////
    if (message.request == "connect-deny") {
      this.socket = null;
      this.app.network.cleanupDisconnectedSocket(this);
      return;
    }


    /////////////////////////
    // reply to connection //
    /////////////////////////
    //
    // we receive this from a server we have connected to. it
    // will contain information such as the public key of that
    // computer that is necessary for us to propagate txs,
    // along with details of their blockchain fork, so that we
    // can send them information if they have fallen behind
    //
    if (message.request == "connect-reply") {

      peer_self.peer.publickey = message.data.publickey;

    //
    // TODO:
    //
    // we need to decide how we handle remote servers that tell
    // us they handle DNS domains. just trusting them seems like
    // a poor decision, but if we do not have a way to decentralize
    // DNS requests that will limit our to serve DNS properly.
    //
    // for (let v = 0; v < message.data.dns.length; v++) {
    //
    // NB: addDomain function has been removed from DNS class
    //
        //  peer_self.app.dns.addDomain(message.data.dns[v], peer_self.peer.publickey);
        //}

      let my_last_bid         = peer_self.app.blockchain.returnLatestBlockId();
      let their_last_block_id = message.data.current_block_id;
      let their_fork_id       = message.data.current_fork_id;

    //
    // update port and host info
    //
      if (message.data.host != "") {
	      peer_self.peer.host         = message.data.host;
	    }
      if (message.data.port != "") {
	      peer_self.peer.port         = message.data.port;
	    }

      console.log("SETTING PEER TO 2: ");
      console.log(JSON.stringify(peer_self.peer));


      //
      // if remote peerreindexing, do not send
      //
      if (message.data.reindexing == 1) { return; }

        if (peer_self.peer.synctype == "lite" && message.data.synctype == "full") { peer_self.peer.synctype = "lite"; }

        if (their_last_block_id < my_last_bid) {
          if (peer_self.peer.synctype == "lite") {
            peer_self.sendBlockchain(their_last_block_id, peer_self.peer.synctype);
          } else {
            if (peer_self.app.BROWSER == 0 && peer_self.app.SPVMODE == 0) {
              peer_self.sendBlockchain(their_last_block_id, peer_self.peer.synctype);
  	        }
          }
        }

        peer_self.app.storage.saveOptions();
        return;
      }


      ////////////////////
      // missing blocks //
      ////////////////////
      if (message.request == "missing block") {

        let t = JSON.parse(message.data);
	      let lasthash = t.lasthash;

      // if lasthash == "", we just send the requested block
        if (lasthash == "") {
          peer_self.app.blockchain.returnBlockByHash(t.hash, function(blk) {
            peer_self.sendBlock("block", blk);
            return;
          });
	      }



        // check to see what the ID of the last hash is....
        peer_self.app.blockchain.returnBlockByHash(lasthash, function(tmpblk) {

	      if (tmpblk == null) { return; }

          if (peer_self.app.BROWSER == 0 && peer_self.app.SPVMODE == 0) {

            peer_self.app.blockchain.returnBlockByHash(t.hash, function(blk) {

	            if (blk == null) { return; }

              let lastblkid = blk.returnId();
              if (tmpblk != null) {
                if (tmpblk.is_valid != 0) {
                  lastblkid = tmpblk.returnId();
                }
              }

              // if we need to send more, send whole blockchain
              if (blk.returnId() > lastblkid) {
                      peer_self.sendBlockchain(tmpblk.returnId()+1, peer_self.peer.synctype);
              } else {
                peer_self.sendBlock("block", blk);
              }
              if (mycallback != null) { mycallback(); }
            });
          }
          return;
        });
      }


      ////////////
      // blocks //
      ////////////
      if (message.request == "block") {

        let expected_block_hash = message.bhash;

        if (peer_self.peer.synctype == "full") {

          peer_self.app.blockchain.importBlock(message.data, expected_block_hash, 1, peer_self.peer.publickey);

        } else {
      //
      // lite blocks not relayed
      //
      // TODO:
      //
      // we probably want something more sophisticated so that
      // we can have chains of lite-nodes and not everyone needs
      // to connect to a full-node. But it isn't critical for now.
      //
      // note that the block hash may not match for lite clients
      // because we may have pruned transactions. The blockchain 
      // class will have to deal with this edge case, but we note
      // it here.
      //
          peer_self.app.blockchain.importBlock(message.data, expected_block_hash, 0, peer_self.peer.publickey);
        }
        return;
      }


      //
      // receive notification block is available
      //
      /////////////////////
      // block available //
      /////////////////////
      if (message.request == "block available") {
        if (message.bhash == null) { return; }
        let block_hash     = message.bhash;
	      if (peer_self.app.blockchain.isHashIndexed(block_hash) != 1) {
          peer_self.app.mempool.fetchBlock(peer_self, block_hash);
	      }
        return;
      }


      //////////////////
      // transactions //
      //////////////////
      if (message.request == "transaction") {
        var tx = new saito.transaction(message.data);
        if (tx == null) { return; }
        if (tx.is_valid == 0) { return; }
        tx.size = message.data.length;
        peer_self.app.mempool.importTransaction(message.data);
        if (mycallback != null) { mycallback(); }
        return;
      }


      ////////////////////
      // golden tickets //
      ////////////////////
      if (message.request == "golden ticket") {
        var tx = new saito.transaction(message.data);
        if (tx == null) { return; }
        if (tx.is_valid == 0) { return; }
        peer_self.app.network.propagateGoldenTicket(tx);
        peer_self.app.mempool.importTransaction(message.data);
        return;
      }


      ////////////////
      // blockchain //
      ////////////////
      if (message.request == "blockchain") {
        peer_self.sendBlockchain(message.data.block_id, message.data.synctype);
        return;
      }


      //////////////////
      // dns requests //
      //////////////////
      //
      // TODO
      //
      // DNS requests should be encrypted. We should also wonder
      // if they should be so low down.
      //
      if (message.request == "dns") {
        peer_self.app.modules.handleDomainRequest(message, peer_self, mycallback);
        return;
      }

    });

  } catch (err) {
    console.log("ERROR - processing remote request: ");
    console.log(JSON.stringify(err));
  }

}


/////////////
// connect //
/////////////
//
// This function is called whenever we connect to another
// node in the network. In typical use case (see the class
// network.js) we will create the peer object and then
// manually add the relevant data before running this
// function as the starting point.
//
// If we are initiating the connection then we set our socket
// events. But either way, we send a message to the remote
// server so that it knows our own situation and we can
// take care of mutual syncing, etc.
//
// The argument remote maps "remote-originated-connection"
// and is 1 for connections that are originated by another
// node.
//
// @params {integer} are we initiating connection?
//
Peer.prototype.connect = function connect(remote = 0) {

  var peer_self = this;

  //
  // is this a remote-originated connection?
  //
  if (remote == 0) {

    //
    // sanity check: do not connect to myself
    //
    if (this.app.options.server != null) {
      if ((this.peer.port == this.app.options.server.port && this.peer.host == this.app.options.server.host) && this.app.BROWSER == 0) { 
        return;
      }
    }

    //
    // open socket
    //
    // var serverAddress;

    // console.log(this.app.options);
    // if (this.app.server.endpoint != null) {
    //   if (this.app.server.endpoint.host != "") {
    //     var { host, port, protocol } = this.app.server.endpoint;
    //     serverAddress = `${protocol}://${host}:${port}`;
    //   }
    // } else {
    //   serverAddress = `http://${this.peer.host}:${this.peer.port}`;
    // }
    var serverAddress = `http://${this.peer.host}:${this.peer.port}`;
    var socket = io(serverAddress);
    this.socket = socket;

    //
    // add events to socket
    //
    this.addSocketEvents();

    //
    // send polite reply with our info, such as our
    // public key so that they can route transactions
    // to us.
    //
    socket.emit('request',JSON.stringify(this.returnConnectMessage()));


  } else {

    //
    // here we respond to a connection attempt
    // by confirming we have all of the information
    // we need about the remote host
    //
    this.socket.emit('request',JSON.stringify(this.returnConnectResponseMessage()));

  }
}


/////////////////////
// fetchBlockchain //
/////////////////////
//
// tell this peer to send us their blockchain
//
Peer.prototype.fetchBlockchain = function fetchBlockchain() {
  var response                           = {};
  response.request                       = "blockchain";
  response.data                          = {};
  response.data.type                     = this.peer.synctype;
  response.data.block_id		 = this.app.blockchain.returnLatestBlockId();
  response.data.keylist                  = this.app.keys.returnWatchedPublicKeys();
  response.data.keylist.push(this.app.wallet.returnPublicKey());
  this.sendRequest(response.request, response.data);
}


///////////////////////
// inTransactionPath //
///////////////////////
//
// is this peer is the transaction path of this transaction?
//
// @params {saito.transaction} transaction to check
//
Peer.prototype.inTransactionPath = function inTransactionPath(tx) {
  if (tx == null) { return 0; }
  if (tx.isFrom(this.peer.publickey)) { return 1; }
  for (let zzz = 0; zzz < tx.transaction.path.length; zzz++) {
    if (tx.transaction.path[zzz].from == this.peer.publickey) {
      return 1;
    }
  }
  return 0;
}

/////////////////
// isConnected //
/////////////////
//
// do we have an active connection?
//
// @returns {boolean} is connected?
//
Peer.prototype.isConnected = function isConnected() {
  if (this.socket != null) {
    if (this.socket.connected == true) {
      return 1;
    }
  }
  return 0;
}


//////////////////////////
// returnConnectMessage //
//////////////////////////
//
// Once we open the socket, we send this message to the
// remote server. This will be processed by the remote 
// server through the functionality that is part of the 
// addSocketEvents class. They will send us a response, 
// through the function:
//
//   returnConnectResponseMessage 
// 
// We will then read their response and sync them up-to-
// date as needed while making sure we have thei public
// key and other key information saved.
//
Peer.prototype.returnConnectMessage = function returnConnectMessage() {

  var message = {};
  message.encrypted             = "no";
  message.request               = "connect";
  message.data                  = {};
  message.data.lastblock        = "";
  message.data.forkid           = "";
  message.data.reindexing       = this.app.storage.currently_reindexing;
  message.data.info             = this.sendtransactions + " / " + this.sendblocks + " / " + this.sendtickets;
  message.data.sendtransactions = this.sendtransactions;
  message.data.sendblocks       = this.sendblocks;
  message.data.sendtickets      = this.sendtickets;
  message.data.publickey        = this.app.wallet.returnPublicKey();
  message.data.keylist          = this.app.keys.returnWatchedPublicKeys();
  message.data.keylist.push(this.app.wallet.returnPublicKey());

  //
  // TODO
  //
  // does this open us up to attack on any grounds? people
  // can DDOS by providing false host data that other clients
  // with then use?
  //
  // it may, but why not just DDOS directly without the use of
  // Saito as an inefficient intermediary, since this is only
  // used for fetching BLOCKS.
  //
  if (this.app.BROWSER == 0) {
    message.data.host             = this.app.options.server.host;
    message.data.port             = this.app.options.server.port;
  }
  message.data.synctype         = "full";

  if (this.app.SPVMODE == 1) {
    this.peer.synctype            = "lite";
    message.data.synctype         = "lite";
  }

  //
  // tell them about where we are in our blockchain
  //
  if (this.app.options.blockchain != null) {
    if (this.app.options.blockchain.latest_block_id > -1) {
      message.data.lastblock    = this.app.options.blockchain.latest_block_id;
    }
    if (this.app.blockchain.returnLatestBlockId() > message.data.lastblock) {
      message.data.lastblock = this.app.blockchain.returnLatestBlockId();
    }
    if (this.app.options.blockchain.fork_id != null) {
      message.data.forkid    = this.app.options.blockchain.fork_id;
    }
  } else {
    message.data.lastblock = -1;
    message.data.forkid = "";
  }
  return message;
}


//////////////////////////////////
// returnConnectResponseMessage //
//////////////////////////////////
//
// If someone else connects to us, we send them this
// message. This includes basic information about our
// server and blockchain status, as well as information 
// about what DNS hosts we serve.
//
Peer.prototype.returnConnectResponseMessage = function returnConnectResponseMessage() {

  var response                           = {};
  response.request                       = "connect-reply";
  response.data                          = {};
  response.data.dns                      = [];
  response.data.publickey                = this.app.wallet.returnPublicKey();
  response.data.synctype                 = this.peer.synctype;
  response.data.reindexing               = this.app.storage.currently_reindexing;
  response.data.current_block_id         = this.app.blockchain.returnLatestBlockId();
  response.data.current_fork_id          = this.app.blockchain.returnForkId();
  response.data.current_genesis_block_id = this.app.blockchain.returnGenesisBlockId();
  if (this.app.BROWSER == 0) {
    response.data.host               	 = this.app.options.server.host;
    response.data.port             	 = this.app.options.server.port;
  }
  response.data.sendConnectReplyResponse = 1;

  //
  // tell the remote server what DNS domains we host
  //
  // they can decide if they trust us or not
  //
  for (let mdns = 0; mdns < this.app.modules.mods.length; mdns++) {
    if (this.app.modules.mods[mdns].isDomainRegistry == 1) {
      response.data.dns.push(this.app.modules.mods[mdns].domain);
    }
  }

  return response;

}


/////////////////////
// returnPublicKey //
/////////////////////
//
// return Public Key of this peer
//
// @returns {string} public key
//
Peer.prototype.returnPublicKey = function returnPublicKey() {
  return this.peer.publickey;
}


////////////////////
// sendBlockchain //
////////////////////
//
// TODO
//
// this is a a rather brutal firehose of data at scale
// and we need to improve the way we handle this but for 
// now, when someone asks for the blockchain, they get it.
//
// @params {integer} block_id to send from
// @params {string} "full" or "lite"
//
Peer.prototype.sendBlockchain = function sendBlockchain(start_bid, type="full") {

  console.log("SENDING BLOCKS FROM DATABASE STARTING WITH BLOCK: "+start_bid + " and type " + type);

  if (start_bid == null) { 
    let tmpx = this.app.blockchain.returnLatestBlock();
    if (tmpx != null) {
      tmpx = tmpx.returnId()-10;
      if (tmpx < 0) { tmpx = 9; }
      start_bid = tmpx;  
    } else {
      start_bid = 0;
    }
  }

  //
  // kick this into the storage class, which manages
  // the chain sync
  //
  this.app.storage.sendBlockchain(start_bid, type, this);

}


///////////////
// sendBlock //
///////////////
//
// send a block to this peer.
//
// if this is a full-node connection we send the entire
// block. if this is a lite-node connection we send only
// the header data plus any requested transactions.
//
// @params {string} "block"
// @params {saito.block} block to send
// @params {boolean} propagate now
//
Peer.prototype.sendBlock = function sendBlock(message, blk, instant=1) {

  // message to send
  //
  // note that we include the hash here
  // so that nodes can check to see if the
  // data they have downloaded is accurate
  // and cut blocks that do not inform
  // them of expected integrity
  //

  var userMessage = {};
      userMessage.request  = message;
      userMessage.data     = "";
      userMessage.bhash    = blk.returnHash();

  // abort if we should
  if (this.sendblocks == 0 && message == "block") { return; }

  // backup txs
  let original_transactions = blk.block.transactions;

  // lite-clients
  if (this.peer.synctype == "lite") {

    var is_important_block = 1;

    //
    // check to see if there is a transaction
    // in this block for this peer. If not
    // just eliminate all transactions from
    // the block.
    // 
    // also check for watchedkeys
    //
    if (this.peer.keylist.length == 0) {
      if (! blk.containsTransactionFor(this.peer.publickey)) {
        is_important_block = 0;
      } 
    } else {
      is_important_block = 0;
      for (let itib = 0; itib < this.peer.keylist.length && is_important_block == 0; itib++) {
        if (blk.containsTransactionFor(this.peer.keylist[itib])) {
          is_important_block = 1; 
        } 
      } 
      if (is_important_block == 0) {
        if (blk.containsTransactionFor(this.peer.publickey)) {
          is_important_block = 1;
        } 
      } 
    } 
    if (is_important_block == 0) {
      blk.block.transactions = [];
    } 
    userMessage.data = JSON.stringify(blk.block);
  } else {

    //
    // SERVERS
    //
    // notify that the block is available, and just send 
    // a quick notice so the other server can decide if
    // if wants to download the whole thing
    //
    //if (blk.filename == "") {
    userMessage.request = "block available";
    userMessage.data    = {};
    //
    // send in-message
    //} else {
    //
    //  userMessage.request = "block";
    //  userMessage.data    = JSON.stringify(blk.block);
    //
    //}
  }

  //
  // restore transactions
  //
  blk.block.transactions = original_transactions;


  //
  // send or disconnect from peer
  //
  // TODO
  //
  // NOTE -- the message queue should only
  // be used at the beginning when we are
  // syncing the blockchain as otherwise
  // it causes issues maintaining a connection
  // for some reason we need to debug.
  //
  if (instant == 1) {
    if (this.socket != null) {
      if (this.socket.connected == true) {
        this.socket.emit('request',JSON.stringify(userMessage));
      } else {
        this.app.network.cleanupDisconnectedSocket(this);
        return;
      }
    } else {
      this.app.network.cleanupDisconnectedSocket(this);
      return;
    }
  } else {
    this.message_queue.push(JSON.stringify(userMessage));
  }
}


/////////////////
// sendRequest //
/////////////////
//
// like sendBlock only for sending a more general request
// that will be interpreted by the function:
//
//   addSocketEvents
//
// on the remote server
//
// @params {string} message (i.e. "block")
// @params {string} data {i.e json object}
// @params {integer} propagate NOW instead of queueing?
//
Peer.prototype.sendRequest = function sendRequest(message, data="") {

  // find out initial state of peer and blockchain
  var userMessage = {};
      userMessage.request  = message;
      userMessage.data     = data;

  // avoid sending unwelcome data
  if (this.sendblocks == 0       && message == "block")         { return; }
  if (this.sendtransactions == 0 && message == "transaction")   { return; }
  if (this.sendtickets == 0      && message == "golden ticket") { return; }

  //
  // if we are initializing, we have to send the message
  // to our queue, as otherwise we will trigger a cleanup
  // of the socket because it is not connected and we will
  // never connect.
  //
  if (this.socket != null) {
    if (this.socket.connected == true) {
      this.socket.emit('request',JSON.stringify(userMessage));
    } else {
      this.app.network.cleanupDisconnectedSocket(this);
      return;
    }
  } else {
    this.app.network.cleanupDisconnectedSocket(this);
    return;
  }

}

/////////////////////////////
// sendRequestWithcallback //
/////////////////////////////
//
// like sendRequest only with a callback
//
// TODO
//
// add encryption if key available
//
// @params {string} message (i.e. "block")
// @params {string} data {i.e json object}
// @params {callback} 
//
// note that propagates instantly because we have a 
// callback to execute and cannot afford to wait
//
Peer.prototype.sendRequestWithCallback = function sendRequestWithCallback(message, data="", mycallback) {

  // find out initial state of peer and blockchain
  var userMessage = {};
      userMessage.request  = message;
      userMessage.data     = data;

  // only send if we have an active connection
  if (this.socket != null) {
    if (this.socket.connected == true) {
      this.socket.emit('request',JSON.stringify(userMessage), mycallback);
      return;
    }
  }

  //
  // this only executes if we are not connected
  // to the peer above
  //
  tmperr = {}; tmperr.err = "peer not connected";
  mycallback(tmperr);

}


Peer.prototype.updatePeerReliability = function updatePeerReliability(feature="", value=0) {

  if ("last_block_connected" == feature) {
    this.last_block_connected = value;
  }
  if ("last_block_valid" == feature) {
    this.last_block_valid = value;
  }
  if ("last_transaction_valid" == feature) {
    this.last_transaction_valid = value;
  }

}
Peer.prototype.isPeerReliable = function isPeerReliable() {

  if (this.last_block_valid == -1) {
    return -1;
  }
  if (this.last_block_connected == 1) {
    return 1;
  }

  return -1;

}

