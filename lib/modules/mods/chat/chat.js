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

            var { author, message, chatRoom } = msg;
            var newmsg = { id: sig, author, message };

            if (chat_self.chat[chatRoom] == null) {
              chat_self.chat[chatRoom] = [newmsg];
            } else {
              chat_self.chat[chatRoom].push(newmsg);
            }
          }
        } catch (err) {
          console.log("ERRR: ");
          console.log(err);
        }
      }
      chat_self.chat.All.unshift({ author: "BearGuy", message: "Welcome to Saito!" });
    } else {
      chat_self.chat.All = [{ author: "BearGuy", message: "Welcome to Saito!" }];
    }
    chat_self.renderMessagesToDOM('All');
  });


  // manually create rooms
  if (chat_self.chat['All'].length == 1) {
    var rooms = ['All', 'Richard', 'David', 'Jack']
    for (i in rooms) {
      $('.chat-room-selector')
        .append(`<option class="chat-room-option" value="${rooms[i]}">${rooms[i]}</option>`)
      chat_self.chat[rooms[i]] = []
    }
  } else {
    for (i in chat_self.chat) {
      $('.chat-room-selector')
        .append(`<option class="chat-room-option" value="${i}">${i}</option>`)
    }
  }
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
    chat_self.receiveChatAddUser(tx, app, counter, 1);

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
    if (tx.transactions.to[0].add == app.wallet.returnPublicKey()) {

      var txmsg = tx.returnMessage();
      var counter = txmsg.counter;

      if (txmsg.request == "chat add user") {
        chat_self.receiveChatAddUser(tx, app, counter, 1);
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
Chat.prototype.receiveChatAddUser = function receiveChatAddUser(tx, app, counter=0, setCounter=1) {

  var chat_self = this;

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

    var { host, port, publickey } = this.app.options.peers[0];
    reply_host   = this.app.options.peers[0].host;
    reply_port   = this.app.options.peers[0].port;
    reply_pubkey = this.app.options.peers[0].pubkey;
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
    reply_relay  = 0; // 0 = this is us

  }


  //
  // by this point we have decided whether we need to send
  // a reply with our own connection information, and what
  // that information is. And so we send it if needed....
  //
  if (reply_needed == 1) {
    var newtx = app.wallet.createUnsignedTransactionWithDefaultFee(app.wallet.returnPublicKey())
    newtx.transaction.msg.module = "Chat";
    newtx.transaction.msg.request = "chat add user";
    newtx.transaction.msg.counter = setCounter; // 1 = replying
    newtx.transaction.msg.relay = reply_relay;
    newtx.transaction.msg.host = reply_host;
    newtx.transaction.msg.port = reply_port;
    newtx.transaction.msg.pubkey = reply_pubkey;
    newtx = app.wallet.signTransaction(newtx);
    app.network.propagateTransaction(newtx);
  }
}


////////////////////////////
// receiveChatSendMessage //
////////////////////////////
Chat.prototype.receiveChatSendMessage = function receiveChatSendMessage(tx, app) {
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
      var chatRoom = $('.chat-room-selector').val();

      if (msg == '') { return }

      //
      // convenient way to add users to our chat app
      //
      // "add 21959827AE41923837D498234CE4719238123"
      //
      if (msg.substring(0,3) == "add" && msg.length > 4) {
        var pubkey_to_add = msg.substring(4);
	chat_self.receiveChatAddUser(null, app, 1, 0);  //null = tx // 1=reply_needed // 0=set counter as 0
        $('.new-message-input').val('');
	return;
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
      var newtx = app.wallet.createUnsignedTransaction(app.wallet.returnPublicKey(), 0.0, 0.0);
      if (newtx == null) { return; }
      newtx.transaction.msg.module = "Chat";
      newtx.transaction.msg.request = "chat send message";
      newtx.transaction.msg.author = "BearGuy";
      newtx.transaction.msg.message = msg;
      newtx.transaction.msg.chatRoom = chatRoom;
      newtx = app.wallet.signTransaction(newtx);

      var data = {};
      data.tx = JSON.stringify(newtx.transaction); // send only tx part
      data.counter = 0

      app.network.sendRequest("chat send message", data);
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

  // browsers only
  if (app.BROWSER == 0) { return; }

  var {msg, sig} = tx.transaction;
  var sig = tx.transaction.sig;
  var { author, message, chatRoom } = msg;
  var newmsg = { id: tx.transaction.sig, author, message };
  this.chat[chatRoom].push(newmsg);

  var messageList = $(`.messages-list#${chatRoom}`)
  if (messageList.length != 0) { messageList.append(this.formatMessage(newmsg)); }

  this.attachEvents(app);
}


Chat.prototype.renderMessagesToDOM = function renderMessagesToDOM(chatRoomValue){
  var chat_self = this;
  var messageListParent = $('.messages-list').parent();
  $('.messages-list').remove()
  var messageList = $(`<ul class="messages-list" id=${chatRoomValue}></ul>`);

  chat_self.chat[chatRoomValue].forEach(function(message){
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
  this.app.options.chat = this.chat;
  this.app.storage.saveOptions();
}

