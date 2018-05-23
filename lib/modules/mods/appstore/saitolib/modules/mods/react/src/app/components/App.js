import React, { Component } from 'react';

class App extends Component {
  render(){
    return (
      <div className="app">
        <div className="header">
          <div className="spacing">
            <h3>ReactApp</h3>
          </div>
        </div>
        <div className="content">
          <div className="spacing">
            <h1>Greetings from React!</h1>
          </div>
        </div>
        <div className="footer">
          <img src="https://upload.wikimedia.org/wikipedia/commons/a/a7/React-icon.svg"
              style={{ height: '4em', justifySelf: 'center'}}/>
        </div>
      </div>
    )
  }
}

export default App