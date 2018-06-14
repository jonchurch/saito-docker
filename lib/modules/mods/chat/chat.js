var saito = require('../../../saito');
var ModTemplate = require('../../template');
var util = require('util');


//////////////////
// CONSTRUCTOR  //
//////////////////
function Chat(app) {

  if (!(this instanceof Chat)) { return new Chat(app); }

  Chat.super_.call(this);

  this.app             = app;

  this.name            = "Chat";
  this.browser_active  = 0;
  this.chat            = this.app.options.chat || {};

  if (this.chat.rooms == null) {
    this.chat.rooms = [];
    this.chat.records = {};
    var newfriend = {
      "host" : "",
      "port" : "",
      "relay" : 0,
      "name" : "All",
      "publickey" : "All",
      "relay_publickey" : ""
    }
    this.chat.rooms.push(newfriend);
    this.chat.records[newfriend.publickey]=[];
  }

  // try to connect to all peers
  //
  // TODO
  //
  // monitor IP address changes and update myself
  //
  for (let p = 0; p < this.chat.rooms.length; p++) {
    let cf = this.chat.rooms[p];
    if (cf.publickey != "All") {
      app.network.addPeer(cf.host, cf.port, 0, 1, 0); // only txs
    }
  }

  return this;

}
module.exports = Chat;
util.inherits(Chat, ModTemplate);



/////////////////////////
// Handle Web Requests //
/////////////////////////
Chat.prototype.webServer = function webServer(app, expressapp) {
  expressapp.get('/chat/', function (req, res) {
    res.sendFile(__dirname + '/web/index.html');
    return;
  });
  expressapp.get('/chat/script.js', function (req, res) {
    res.sendFile(__dirname + '/web/script.js');
    return;
  });
  expressapp.get('/chat/style.css', function (req, res) {
    res.sendFile(__dirname + '/web/style.css');
    return;
  });
}


/////////////////////
// Initialize HTML //
/////////////////////
Chat.prototype.initializeHTML = function initializeHTML(app) {

  var chat_self = this;

  // load archived messages
  app.archives.processTransactions(30, function (err, txarray) {
    if (txarray.length != 0) {
      for (let bv = 0; bv < txarray.length; bv++) {
        try {

          if (txarray[bv].transaction == [] || txarray[bv].transaction == null) { return; }
          var {msg, sig} = txarray[bv].transaction;
          if (msg.module == "Chat") {

            var publickey = tx.transaction.from[0].add;
            var author = tx.transaction.from[0].add;
            var message = msg.message;
            var chatRoom = 0;

	    for (let v = 0; v < chat_self.chat.rooms.length; v++) {
	      if (chat_self.chat.rooms[v].publickey == author) {
		 chatRoom = v;
 		 v = chat_self.chat.rooms[v].length+1;
	       }
            };
            var newmsg = { id: sig, author, message };

            if (chat_self.chat.records[publickey] == null) {
              chat_self.chat.records[publickey] = [newmsg];
            } else {
              newmsg.author = chat_self.chat.rooms[chatRoom].name;
              chat_self.chat.records[chatRoom].push(newmsg);
            }
          }
        } catch (err) {
          console.log("ERRR: ");
          console.log(err);
        }
      }
      if (chat_self.chat.records["All"] == null) {
        chat_self.chat.records["All"] = [];
      }
      if (chat_self.chat.records["All"].length == 0) {
        chat_self.chat.records["All"].unshift({ author: "BearGuy", message: "Welcome to Saito!" });
      }
    } else {
      chat_self.chat.records["All"] = [{ author: "BearGuy", message: "Welcome to Saito!" }];
    }
    chat_self.renderMessagesToDOM('All');
  });


  // load chat rooms
  for (let i = 0; i < chat_self.chat.rooms.length; i++) {
    chat_self.addChatRoom(i);
  }
}

Chat.prototype.addChatRoom = function addChatRoom(i) {
  var chat_self = this;
  $('.chat-room-selector').append(`<option class="chat-room-option" value="${chat_self.chat.rooms[i].publickey}">${chat_self.chat.rooms[i].name}</option>`)
}



///////////////////////
// handlePeerRequest //
///////////////////////
//
// zero-fee transactions sent directly to us by chat-peers end up
// here. we handle them just like paid transactions sent over the
// blockchain. paid & free are interchangeable.
//
Chat.prototype.handlePeerRequest = function handlePeerRequest(app, req, peer, mycallback) {

  var chat_self = this;

  if (req.request == null) { return; }
  if (req.data == null) { return; }

  var tx = new saito.transaction(req.data.tx);

  if (tx == null) { return;}

  ///////////////////////
  // chat send message //
  ///////////////////////
  if (req.request === "chat send message") {

    if (req.data.counter == null) {
      console.log("ERROR: counter not defined");
      return;
    }

    /////////////////////
    // relay message ? //
    /////////////////////
    tx.decryptMessage(chat_self.app);
    var txmsg = tx.returnMessage();

    let from = txmsg.from;
    let to = txmsg.to;
    let relay = txmsg.relay;
    let message = txmsg.message;
    let sig = txmsg.sig;

    if (from == chat_self.app.wallet.returnPublicKey()) { return; }

    if (relay == 1 && to != chat_self.app.wallet.returnPublicKey()) {
      var peers = chat_self.app.network.peers;
      for (let p = 0; p < peers.length; p++) {
        if (peers[p].peer.publickey == to) {

          var newtx = app.wallet.createUnsignedTransaction(to, 0.0);
          if (newtx == null) { return; }
          newtx.transaction.msg.module  = "Chat";
          newtx.transaction.msg.request = "chat send message";
          newtx.transaction.msg.from    = from;
          newtx.transaction.msg.to      = to;
          newtx.transaction.msg.relay   = 1;
          newtx.transaction.msg.message = message;
          newtx.transaction.msg.sig     = sig;
          newtx.transaction.msg.tx      = JSON.stringify(tx.transaction);
	  newtx.transaction.msg 	= app.keys.encryptTransaction(to, newtx.transaction.msg);
          newtx = app.wallet.signTransaction(newtx);


          relreq = {};
          relreq.request = "chat send message";
          relreq.data = {};
          relreq.data.tx = JSON.stringify(newtx.transaction);
          relreq.data.counter = 1;
          peers[p].sendRequest(relreq.request, relreq.data);

          return;
        }
      }
      return;
    }

    chat_self.receiveChatSendMessage(tx, app);

    ///////////////////////
    // TESTING -- bounce //
    ///////////////////////
    if (req.data.counter == 0) {
      var newreq = {};
      newreq.request = "chat send message";
      newreq.data = {};
      newreq.data.tx = req.data.tx;
      newreq.data.counter = 1;
      app.network.sendRequest(newreq.request, newreq.data);
    }
  }


  ///////////////////
  // chat add user //
  ///////////////////
  if (req.request === "chat add user") {

    if (req.data == null) {
      console.log("ERROR -- data not defined in chat add user");
      return;
    }
    if (req.data.tx == null) { 
      console.log("ERROR -- data tx not defined in chat add user"); 
      return; 
    }

    let counter = req.data.counter;
    chat_self.receiveChatAddUser(tx, app, counter, 1, tx.transaction.from[0].add);

  }
}


////////////////////
// onConfirmation //
////////////////////
//
// paid transactions sent over the blockchain end up here. we
// handle them just like zero-fee transactions sent peer-to-peer
//
Chat.prototype.onConfirmation = function onConfirmation(blk, tx, conf, app) {

  var chat_self = app.modules.returnModule("Chat");


  if (conf == 0) {
    if (tx.transaction.to[0].add == app.wallet.returnPublicKey()) {

      var txmsg = tx.returnMessage();
      var counter = txmsg.counter;

      if (txmsg.request == "chat add user") {
        console.log("TX INSIDE onConfirmation", tx.transaction)
        chat_self.receiveChatAddUser(tx, app, counter, 1, tx.transaction.from[0].add);
        return;
      }
      if (txmsg.request == "chat send message") {
        chat_self.receiveChatSendMessage(tx, app);
        return;
      }
    }
  }
}


////////////////////////
// receiveChatAddUser //
////////////////////////
Chat.prototype.receiveChatAddUser = function receiveChatAddUser(tx, app, counter=0, setCounter=1, toAddress) {

  var chat_self = this;

  ///////////////////////////
  // save remote user info //
  ///////////////////////////
  //
  // tx will be null if we are calling this
  // to SEND the initial message, in which
  // case counter = 1 (reply_needed) and
  // setCounter = 1 (demand reply from peer)
  //
  if (tx != null) {

    let txmsg = tx.returnMessage();
    let remote_relay        = txmsg.relay;
    let remote_host         = txmsg.host;
    let remote_port         = txmsg.port;
    let remote_relay_pubkey = txmsg.publickey;
    let remote_user_pubkey  = tx.transaction.from[0].add;

    if (remote_relay_pubkey == undefined) { remote_relay_pubkey = ""; }

    var newfriend = {
      "host" : remote_host,
      "port" : remote_port,
      "relay" : remote_relay,
      "name" : remote_user_pubkey,
      "publickey" : tx.transaction.from[0].add,
      "relay_publickey" : remote_relay_pubkey
    }

    if (this.chat.rooms == null) { this.chat.rooms = []; }
    let nfexists = 0;
    for (let i = 0; i < this.chat.rooms.length; i++) {
      if (newfriend.publickey == this.chat.rooms[i].publickey) { nfexists = 1; }
    }
    if (nfexists == 0) {

      chat_self.app.dns.fetchIdentifier(newfriend.publickey, function (answer) {

        // name currently publickey
        var newmsg = {
          id: tx.transaction.msig,
  	  author: newfriend.name,
          message: "opens chat channel"
        };

        
        var chatRoomPublicKey = $('.chat-room-selector').val();

console.log("rendering... " + chatRoomPublicKey);

        if (chat_self.app.dns.isRecordValid(answer) == 0) {
          newfriend.name = newfriend.name.substring(0,8),
          newmsg.author = newfriend.name;
          chat_self.chat.rooms.push(newfriend);
          chat_self.chat.records[newfriend.publickey] = [];
          chat_self.addChatRoom(chat_self.chat.rooms.length-1);
          chat_self.chat.records["All"].push(newmsg);
          chat_self.renderMessagesToDOM(chatRoomPublicKey);
          chat_self.saveChat();
          return;
        }

        dns_response = JSON.parse(answer);

        if (dns_response.identifier != "") {
          newfriend.name = dns_response.identifier;
          newmsg.author = newfriend.name;
          chat_self.chat.rooms.push(newfriend);
          chat_self.chat.records[newfriend.publickey] = [];
          chat_self.addChatRoom(chat_self.chat.rooms.length-1);
          chat_self.chat.records["All"].push(newmsg);
          chat_self.renderMessagesToDOM(chatRoomPublicKey);
          chat_self.saveChat();
          return;
        }

        newfriend.name = newfriend.name.substring(0,8),
        chat_self.chat.rooms.push(newfriend);
        chat_self.chat.records[newfriend.publickey] = [];
        chat_self.addChatRoom(chat_self.chat.rooms.length-1);
        chat_self.chat.records["All"].push(newmsg);
        chat_self.renderMessagesToDOM(chatRoomPublicKey);
        chat_self.saveChat();
        return;

      });
    }
  }




  let reply_needed = 0;
  let reply_port   = "";
  let reply_host   = "";
  let reply_pubkey = "";
  let reply_relay  = 0;

  if (counter == 0 ) { reply_needed = 1; }


  /////////////
  // browser //
  /////////////
  if (app.BROWSER == 1) {

    //
    // TODO
    //
    // we assume our first peer is a server if we are a browser, but
    // lite-clients will eventually want to be able to decide which
    // peers are relaying chat messages for them. we just currently
    // default to the first peer as most lite-clients will only have
    // a single peer --- the server feeding out modules to them.
    //

    if (this.app.options.peers == null) { return; }
    if (this.app.options.peers[0] == null) { return; }

    reply_host   = this.app.options.peers[0].host;
    reply_port   = this.app.options.peers[0].port;
    reply_pubkey = this.app.options.peers[0].publickey;

    if (reply_pubkey == undefined) { reply_pubkey = ""; }

    reply_relay  = 1;  // 1 = this is a relay, not us


  ////////////
  // server //
  ////////////
  } else {

    if (chat_self.app.server == null) { return; }
    if (chat_self.app.server.server == null) { return; }

    reply_host   = chat_self.app.server.server.host;
    reply_port   = chat_self.app.server.server.port;
    reply_pubkey = chat_self.app.server.server.publickey;

    if (reply_pubkey == undefined) { reply_pubkey = ""; }

    reply_relay  = 0; // 0 = this is us

  }

  //
  // by this point we have decided whether we need to send
  // a reply with our own connection information, and what
  // that information is. And so we send it if needed....
  //
  if (reply_needed == 1) {
    var newtx = app.wallet.createUnsignedTransactionWithDefaultFee(toAddress, 0.0)
    newtx.transaction.msg.module = "Chat";
    newtx.transaction.msg.request = "chat add user";
    newtx.transaction.msg.counter = setCounter; // 1 = replying
    newtx.transaction.msg.relay = reply_relay;
    newtx.transaction.msg.host = reply_host;
    newtx.transaction.msg.port = reply_port;
    newtx.transaction.msg.publickey = reply_pubkey;
    newtx = app.wallet.signTransaction(newtx);
    newtx.transaction.msg 	= app.keys.encryptTransaction(to, newtx.transaction.msg);
    app.network.propagateTransaction(newtx);
  }

}


////////////////////////////
// receiveChatSendMessage //
////////////////////////////
Chat.prototype.receiveChatSendMessage = function receiveChatSendMessage(tx, app) {
console.log("TRANSACTION: " + JSON.stringify(tx));
  this.attachMessage(tx, app);
}


//////////////////
// attachEvents //
//////////////////
Chat.prototype.attachEvents = function attachEvents(app) {

  var chat_self = this;

  $('.new-message-input').off();
  $('.new-message-input').on('keypress', function(e) {
    if (e.which == 13 || e.keyCode == 13) {

      console.log(JSON.stringify(chat_self.chat, null, 4));
      var msg = $('.new-message-input').val();
      var chatRoomPublickey = $('.chat-room-selector').val();
      var chatRoom;

      for (let y = 0; y < chat_self.chat.rooms.length; y++) {
        if (chatRoomPublickey == chat_self.chat.rooms[y].publickey) {
	        chatRoom = y;
	        y = chat_self.chat.rooms.length+1;
        }
      }

      if (msg == '') { return }

      //
      // convenient way to add users to our chat app
      //
      // "add 21959827AE41923837D498234CE4719238123"
      //
      if (msg.substring(0,3) == "add" && msg.length > 4) {
        var pubkey_to_add = msg.substring(4);

	var is_public_key = chat_self.app.crypt.isPublicKey(pubkey_to_add);

        if (is_public_key == 1) {
          console.log("ADDING: " + pubkey_to_add);
          chat_self.receiveChatAddUser(null, app, 0, 0, pubkey_to_add); 	// null = tx
									// 0=counter (reply_needed)
									// 0=set counter as 0
          $('.new-message-input').val('');
	  return;

        } else {

          chat_self.app.dns.fetchPublicKey(pubkey_to_add, function(answer) {
            if (chat_self.app.dns.isRecordValid(answer) == 0) {
              alert("We cannot find the public key of that address");
              return;
            }
            dns_response = JSON.parse(answer);
            chat_self.receiveChatAddUser(null, app, 0, 0, dns_response.publickey); 	// null = tx
									// 0=counter (reply_needed)
									// 0=set counter as 0
            $('.new-message-input').val('');
	    return;
          });

	  return;
        }

      }

      //
      // if we reach this part of the function, we are NOT adding
      // a new user to our chat application, which means we want
      // to send a message to whatever Room we are in through an
      // off-chain peer-to-peer message
      //
      // note the inclusion of the "chat send message" request within
      // the transaction as well as outside in the request. This is a
      // convenience so we can use the same function to handle off-chain
      // and onchain messages.
      //
      // TODO
      //
      // we need to get the public key of the person we are sending stuff to
      //
      let dest_port            = chat_self.chat.rooms[chatRoom].port;
      let dest_host            = chat_self.chat.rooms[chatRoom].host;
      let dest_publickey       = chat_self.chat.rooms[chatRoom].publickey;
      let dest_relay           = chat_self.chat.rooms[chatRoom].relay;
      let dest_relay_publickey = chat_self.chat.rooms[chatRoom].relay_publickey;

      let addy = dest_publickey;
      if (dest_relay == 1 && dest_relay_publickey != "") { addy = dest_relay_publickey; }
      if (addy == "") { addy = chat_self.app.wallet.returnPublicKey(); }

      // create tx to send to user
      var newtx = app.wallet.createUnsignedTransaction(addy, 0.0, 0.0);
      if (newtx == null) { return; }
      newtx.transaction.msg.module  = "Chat";
      newtx.transaction.msg.request = "chat send message";
      newtx.transaction.msg.from    = app.wallet.returnPublicKey();
      newtx.transaction.msg.to      = dest_publickey;
      newtx.transaction.msg.relay   = dest_relay;
      newtx.transaction.msg.message = msg;
      newtx.transaction.msg.sig     = chat_self.app.wallet.signMessage(msg);
      newtx.transaction.msg 	= app.keys.encryptTransaction(to, newtx.transaction.msg);
      newtx = app.wallet.signTransaction(newtx);

      var data = {};
      data.tx = JSON.stringify(newtx.transaction); // send only tx part
      data.counter = 0;
      var author = app.wallet.returnPublicKey().substring(0,8);
      if (app.wallet.returnIdentifier() != "") { author = app.wallet.returnIdentifier(); }
      for (let v = 0; v < chat_self.chat.rooms.length; v++) {
        if (chat_self.chat.rooms[v].publickey == chat_self.app.wallet.returnPublicKey()) {
          chatRoom = v;
          author = chat_self.chat.rooms[v].name;
        }
      }


      console.log("Message Data from attachEvents", data);

      var newmsg = {
        id: newtx.transaction.sig,
	author: author,
        message: msg
      };

      // Render message to DOM here
      chat_self.chat.records[chatRoomPublickey].push(newmsg);

      console.log("SAVING CHAT!");
      chat_self.saveChat();

      var messageList = $(`.messages-list#${chatRoomPublickey}`)
      if (messageList.length != 0) { messageList.append(chat_self.formatMessage(newmsg)); }

      if (chatRoom == "All") {
        app.network.sendRequest("chat send message", data);
      } else {

      //
      // TODO
      //
      // fix this so we only send to the relay server with a ZERO-FEE TX
      //

        app.network.sendRequest("chat send message", data);
      }

      $('.new-message-input').val('');

      //
      // TODO
      //
      // do we really want to save these chat messages we
      // are sending?
      //
      app.archives.saveTransaction(newtx);
    }
  });

  $('.chat-room-selector').change(function(){
    console.log($(this).val());
    chat_self.renderMessagesToDOM($(this).val());
  });
}



Chat.prototype.formatMessage = function formatMessage({id, author, message}){
  return `
  <p id="#message_id_${id}" class="message">
    <i>${author}</i>: ${message}
  </p>
  `
}


Chat.prototype.attachMessage = function attachMessage(tx, app) {

  var chat_self = this;

  // browsers only
  if (app.BROWSER == 0) { return; }

  tx.decryptMessage();
  var txmsg = tx.returnMessage();

  var message = txmsg.message;
  var sig     = txmsg.sig;
  var from    = txmsg.from;
  var to      = txmsg.to;
  var sig     = txmsg.sig;

  // fetch chatroom from rooms
  var chatRoom = 0;

  if (to != app.wallet.returnPublicKey()) {
    var chatRoomPublicKey = to;
  } else {
    var chatRoomPublicKey = from;
  }

  var author   = from;
  var roomName = from.substring(0,8);
  var chatRoom = 0;
  for (let v = 0; v < chat_self.chat.rooms.length; v++) {

console.log(chat_self.chat.rooms[v].publickey + " -- " + author);

console.log(JSON.stringify(chat_self.chat.rooms));

    if (chat_self.chat.rooms[v].publickey == author) {
console.log("SUCCESS!");
      chatRoom = v;
      roomName = chat_self.chat.rooms[v].name;
      v = chat_self.chat.rooms[v].length+1;
    }
  }

console.log("Here we are with author/roomName: " + roomName);

  var newmsg = { id: tx.transaction.sig, author: roomName, message };

  this.chat.records[chatRoomPublicKey].push(newmsg);

  if (chatRoomPublicKey != "All") {
    let notification = {
      id: `notification_${chatRoomPublicKey}`,
      author: "Notification",
      message: `${roomName} has sent you a message!`
    }

    this.chat.records["All"].push(notification)

    let messageList = $(`.messages-list#All`)
    if (messageList.length != 0) { messageList.append(this.formatMessage(notification)); }
  }

  console.log("SAVING CHAT!");
  this.saveChat();

  var messageList = $(`.messages-list#${chatRoomPublicKey}`)
  if (messageList.length != 0) { messageList.append(this.formatMessage(newmsg)); }

  this.attachEvents(app);
}


Chat.prototype.renderMessagesToDOM = function renderMessagesToDOM(chatRoomPublicKey){
  var chat_self = this;
  var messageListParent = $('.messages-list').parent();
  $('.messages-list').remove()
  var messageList = $(`<ul class="messages-list" id=${chatRoomPublicKey}></ul>`);

  console.log(chat_self.chat.records)
  console.log("This is the chatRoomPublicKey", chatRoomPublicKey)

  chat_self.chat.records[chatRoomPublicKey].forEach(function(message){
    messageList.append(chat_self.formatMessage(message));
  })

  messageListParent.append(messageList);
}


Chat.prototype.isPublicKey = function isPublicKey(publickey) {
  if (publickey.length == 44 || publickey.length == 45) {
    if (publickey.indexOf("@") > 0) {} else {
      return 1;
    }
  }
  return 0;
}


Chat.prototype.saveChat = function saveChat() {

  for (var obj in this.chat.records) {
    if (this.chat.records[obj].length >= 2) {
      this.chat.records[obj].reverse();
      this.chat.records[obj] = this.chat.records[obj].splice(0, 2);
      this.chat.records[obj].reverse();
    }    
  }


  this.app.options.chat = this.chat;
  this.app.storage.saveOptions();
}

