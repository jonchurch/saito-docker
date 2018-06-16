const saito = require('../saito');


/////////////////
// Constructor //
/////////////////
function Network(app) {

  if (!(this instanceof Network)) {
    return new Network(app);
  }

  this.app     = app || {};

  this.peers    		= [];
  this.peer_monitor_timer 	= null;
  this.peer_monitor_timer_speed = 10000;  // check socket status every 10 seconds
  this.peers_connected 		= 0;
  this.peers_connected_limit	= 20; // max peers


  return this;

}
module.exports = Network;




////////////////
// initialize //
////////////////
//
// We check our options to see to which peers we should 
// be connecting, and start the connection process. Note
// that connections are not instant, which is why the 
// mempool class checks the options file to see if we
// have active peers.
//
// Once peers are setup, we start a timer that monitors 
// them to handle socket disconnections, etc.
//
Network.prototype.initialize = function initialize() {

  var network_self = this;

  // connect to peers
  if (this.app.options.peers != null) {
    for (let i = 0; i < this.app.options.peers.length; i++) {
      var {host, port, protocol} = this.app.options.peers[i];
      this.addPeer(host, port, protocol);
    }
  }

  // monitor peers
  this.peer_monitor_timer = setInterval(function() {
    for (let i = network_self.peers.length-1; i >= 0; i--) {
      if (network_self.peers[i].isConnected() == 0) {
        network_self.cleanupDisconnectedSocket(network_self.peers[i]);
      }
    }
  }, network_self.peer_monitor_timer_speed);

}


/////////////
// addPeer //
/////////////
//
// This function connects outwards to other nodes. If another
// node connects to us, it will come in through the function
//
//   addPeerWithSocket
//
// We do a quick sanity check to make sure we are not connecting
// to ourselves before we connect to a peer node.
//
// @params {string} peer IP address
// @params {integer} peer port
// @params {boolean} send blocks to this peer
// @params {boolean} send transactions to this peer
// @params {boolean} send golden ticket solutions to this peer
//
Network.prototype.addPeer = function addPeer(peerhost, peerport, peerprotocol='http', sendblks=1, sendtx=1, sendgtix=1) {

  //
  // no duplicate connections
  //
  for (let i = 0; i < this.peers.length; i++) {
    if (this.peers[i].peer.host == peerhost && this.peers[i].peer.port == peerport) {
      if (sendblks == 1) { this.peers[i].sendblocks = 1; }
      if (sendtx   == 1) { this.peers[i].sendtransactions = 1; }
      if (sendgtix == 1) { this.peers[i].sendtickets = 1; }
      return;
    }
  }

  //
  // we check our own address to be sure we are
  // not the node to which we are connecting.
  //
  if (this.app.options.server != null) {
    if (this.app.options.server.host == peerhost && this.app.options.server.port == peerport) {
      console.log("Not adding "+this.app.options.server.host+" as peer node as it is our server.");
      return;
    }
  }

  this.peers.push(new saito.peer(this.app));
  this.peers[this.peers.length-1].peer.host        = peerhost;
  this.peers[this.peers.length-1].peer.port        = peerport;
  this.peers[this.peers.length-1].peer.protocol    = peerprotocol;
  this.peers[this.peers.length-1].sendblocks       = sendblks;
  this.peers[this.peers.length-1].sendtransactions = sendtx;
  this.peers[this.peers.length-1].sendtickets      = sendgtix;
  this.peers[this.peers.length-1].connect();

  this.peers_connected++;

}


///////////////////////
// addPeerWithSocket //
///////////////////////
//
// Foreign-originated connections hit our network class here.
// If we are originating the connection ourselves, we want to
// use the function:
//
//   addPeer
//
// Sanity check this is not a duplicate connection then add.
//
// @params {socket.io-client socket} peer socket
//
Network.prototype.addPeerWithSocket = function addPeerWithSocket(socket) {

  // deny excessive connections
  if (this.peers_connected >= this.peers_connected_limit) {
    var message = {};
        message.request               = "connect-deny";
    socket.emit('request',JSON.stringify(message));
    socket.disconnect();
    return;
  }

  // sanity check
  for (let i = 0; i < this.peers.length; i++) {
    if (this.peers[i].socket_id == socket.id) {
      console.log("error adding socket: already in pool");
      return;
    }
  }

  this.peers.push(new saito.peer(this.app));
  this.peers[this.peers.length-1].socket = socket;
  this.peers[this.peers.length-1].addSocketEvents();
  this.peers[this.peers.length-1].connect("remote-originated-connection");

  this.peers_connected++;

}


///////////////////////////////
// cleanupDisconnectedSocket //
///////////////////////////////
//
// remove disconnected peers from our list of peers
//
// @params {saito.peer} peer to remove
//
Network.prototype.cleanupDisconnectedSocket = function cleanupDisconnectedSocket(peer) {

  for (let c = 0; c < this.peers.length; c++) {
    if (this.peers[c] == peer) {

      //
      // we do not want to remove socket connections from
      // peers that are explicitly in our list, as they
      // may reconnect and we will want to resync.
      //
      if (this.app.options.peers != null) {
        for (let d = 0; d < this.app.options.peers.length; d++) {
          if (this.app.options.peers[d].host == peer.peer.host && this.app.options.peers[d].port == peer.peer.port) {
	    return;
	  }
        }
      }

      //
      // otherwise remove peer, they will
      // have to explicitly reconnect to get
      // us to message them again.
      //
      clearInterval(this.peers[c].message_queue_timer);
      this.peers.splice(c, 1);
      c--;
      this.peers_connected--;
console.log("REMOVING PEERS, peers remaining: " + this.peers_connected + " -- " + this.peers.length);
    }
  }
}


/////////////////
// isConnected //
/////////////////
//
// returns 1 if we are connected to this peer
//
// @params {boolean} is connected?
//
Network.prototype.isConnected = function isConnected() {
  for (let k = 0; k < this.peers.length; k++) {
    if (this.peers[k].isConnected() == 1) { return 1; }
  }
  return 0;
}



////////////////////
// propagateBlock //
////////////////////
//
// propagates a block to the network
//
// right now this directly calls the "sendBlock" function
// but we have a separate function here as in the future 
// we may wish to be more selective about the nodes to 
// which we send blocks as part of active bandwidth 
// management.
//
// We should aim to have the code send blocks here if they
// want the network class to deal with them, or directly to 
// sendBlock if they want to send it to all connections.
//
// @params {saito.block} block
//
Network.prototype.propagateBlock = function propagateBlock(blk) {
  if (blk == null) { return; }
  if (blk.is_valid == 0) { return; }
  this.sendBlock("block", blk);
}


///////////////////////////
// propagateGoldenTicket //
///////////////////////////
//
// propagates a golden ticket to all peers
//
// @params {saito.transaction} transaction with a golden ticket solution
//
Network.prototype.propagateGoldenTicket = function propagateGoldenTicket(gttx) {
  if (gttx == null) { return; }
  if (gttx.is_valid == 0) { return; }
  if (gttx.transaction.gt == null) { return; }
  this.propagateTransaction(gttx, "golden ticket");
}


//////////////////////////
// propagateTransaction //
//////////////////////////
//
// propagate a transaction out onto the network
//
// note that golden tickets piggy-back on this 
// by changing the outboundMessage, which is why
// it is not hard-coded.
//
// @params {saito.transaction}
// @params {callback}
//
Network.prototype.propagateTransaction = function propagateTransaction(tx, outboundMessage="transaction", mycallback=null) {

  if (tx == null) { return; }
  if (tx.is_valid == 0) { return; }

  //
  // add to mempool if it does not already exit
  //
  if (this.app.BROWSER == 0 && this.app.SPVMODE == 0) {
    if (this.app.mempool.containsTransaction(tx) != 1) {
      if ( (this.app.mempool.returnBundlingFeesNeeded() - tx.returnFeeUsable()) <= 0) {
        this.app.mempool.addTransaction(tx);
        //
        // return as we can create a block
	//
        return;
      } else {
        this.app.mempool.addTransaction(tx);
      }
    }
  }

  //
  // sign transaction for our peers and propagate
  //
  for (let networki = 0; networki < this.peers.length; networki++) {

    // if peer not on path
    if (! this.peers[networki].inTransactionPath(tx) ) {

      // create a temporary transaction
      //
      // try/catch block exists as it is possible to create
      // a JSON string that JSON class cannot parse successfully
      //
      try {
        var tmptx = new saito.transaction();
            tmptx.transaction = JSON.parse(JSON.stringify(tx.transaction));
      } catch (err) { 
	      return; 
      }

      // add our path
      var tmppath = new saito.path();
          tmppath.from = this.app.wallet.returnPublicKey();
          tmppath.to   = this.peers[networki].returnPublicKey();
          tmppath.sig  = this.app.crypt.signMessage(tmppath.to, this.app.wallet.returnPrivateKey());

      tmptx.transaction.path.push(tmppath);
      if (mycallback == null) {
	      this.peers[networki].sendRequest(outboundMessage, JSON.stringify(tmptx.transaction));
      } else {
	      this.peers[networki].sendRequestWithCallback(outboundMessage, JSON.stringify(tmptx.transaction), mycallback);
      }
    }
  }
}


//////////////////////////////////////
// propagateTransactionWithCallback //
//////////////////////////////////////
//
// socket.io allows us to send messages and have the 
// other peer invoke a callback. this function wraps
// this functionality. it is provided so that modules
// can confirm.
//
// TODO:
//
// make callback messages secure/encrypted by default
// if a key exists between us and our target peer. 
//
// make sure callback message only fires X times, 
// instead of once for every peer that receives it.
//
Network.prototype.propagateTransactionWithCallback = function propagateTransactionWithCallback(tx, mycallback=null) {
  this.propagateTransaction(tx, "transaction", mycallback);
}


///////////////
// sendBlock //
///////////////
//
// broadcast block to all peers
//
// some redundancy with propagateBlock
//
// @params {string} request for message
// @params {saito.block} block
//
Network.prototype.sendBlock = function sendBlock(message, blk) {
  if (blk == null) { return; }
  if (blk.is_valid == 0) { return; }
  for (let x = this.peers.length-1; x >= 0; x--) {
    this.peers[x].sendBlock(message, blk);
  }
}


/////////////////
// sendRequest //
/////////////////
//
// this lets us micromanage the information we broadcast
// to our peers. the message is what is filtered-on by
// peers when deciding how to treat incoming messages, while
// the data is whatever data is then read-in by the software
//
// i.e. for a block this would be:
//
//   message = "block"
//   data    = JSON.stringify(blk.block)
//
// @params {string} request message
// @params {saito.block} request data
//
Network.prototype.sendRequest = function sendRequest(message, data="") {
  for (var x = this.peers.length-1; x >= 0; x--) {
    this.peers[x].sendRequest(message, data);
  }
}


/////////////////////
// fetchBlockchain //
/////////////////////
//
// we know we need to fetch the blockchain, so lets do that
// this informs our peers that we would like to sync the 
// blockchain. it passes control individually to the individual
// peers.
//
// the fork_id comes in here, as we may have peers with slightly
// different IDs, which is why we sync across the whole network.
//
// TODO
//
// improve efficiency and avoid bandwidth issues by making our
// blockchain syncing code more efficient, so that we only need
// to fetch data from one server, for instance, and then check
// that data with other servers.
//
Network.prototype.fetchBlockchain = function fetchBlockchain() {
  for (let x = 0; x < this.peers.length; x++) {
    if (this.peers[x].socket != null) {
      if (this.peers[x].isConnected() == true) {
        this.peers[x].fetchBlockchain();
        return;
      }
    }
  }
  return;
}

Network.prototype.close = function close() {
  for (let i = 0; i < this.peers.length; i++) {
    this.peers[i].socket.disconnect();
  }
  return;
}


///////////////////////////
// updatePeerReliability //
///////////////////////////
//
// updates the reliability value of the peer with the specified 
// key. this is used to track how reliable the peers are in order
// to provide a basic defense against flooding attacks.
//
// @params {string} public key of peer
// @params {string} variable to update
// @params {value}  new value (-1, 0, 1);
//
Network.prototype.updatePeerReliability = function updatePeerReliability(publickey="", feature="", value=0) {

  for (let x = 0; x < this.peers.length; x++) {
    if (this.peers[x].peer.publickey == publickey) {
      this.peers[x].updatePeerReliability(feature, value);
      return;
    }
  }

  return;

}
Network.prototype.isPeerReliable = function isPeerReliable(publickey) {

  for (let x = 0; x < this.peers.length; x++) {
    if (this.peers[x].peer.publickey == publickey) {
      return this.peers[x].isPeerReliable();
    }
  }

  return 1;

}



