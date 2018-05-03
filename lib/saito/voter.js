'use strict';

const saito = require('../saito');


function Voter(app) {

  if (!(this instanceof Voter)) {
    return new Voter(app);
  }

  this.app                      = app || {};

  this.voter                    = {};
  this.voter.vote_on_difficulty = 0;
  this.voter.target_difficulty  = 2;
  this.voter.vote_on_paysplit   = 0;
  this.voter.target_paysplit    = 0.5;

  return this;

}
module.exports = Voter;


Voter.prototype.initialize = function initialize() {
  if (this.app.options.voter != null) {
    this.voter.vote_on_difficulty = this.app.options.voter.vote_on_difficulty;
    this.voter.target_difficulty  = this.app.options.voter.target_difficulty;
    this.voter.vote_on_paysplit   = this.app.options.voter.vote_on_paysplit;
    this.voter.target_paysplit    = this.app.options.voter.target_paysplit;
  }
}
Voter.prototype.prefers = function prefers(block_a, block_b) {
  if (block_a.block.paysplit > this.voter.target_paysplit) {
      if (block_a.block.paysplit_vote == -1 && block_b.block.paysplit_vote > -1) { return 1; }
      if (block_a.block.paysplit_vote == 0  && block_b.block.paysplit_vote > 0)  { return 1; }
  } else {
    if (block_a.block.paysplit == this.voter.target_paysplit) {} else {
      if (block_a.block.paysplit_vote == 1 && block_b.block.paysplit_vote < 1)  { return 1; }
      if (block_a.block.paysplit_vote == 0  && block_b.block.paysplit_vote < 0) { return 1; }
    }
  }
  return 0;
}
Voter.prototype.returnDifficultyVote = function returnDifficultyVote(difficulty) {
  if (this.voter.vote_on_difficulty == 1) {
    if (difficulty < target_difficulty) { return 1; }
    if (difficulty > target_difficulty) { return -1; }
    return 0;
  } else {
    return 0;
  }
}
Voter.prototype.returnPaysplitVote   = function returnPaysplitVote(paysplit) {
  if (this.voter.vote_on_paysplit == 1) {
    if (paysplit < target_paysplit) { return 1; }
    if (paysplit > target_paysplit) { return -1; }
    return 0;
  } else {
    return 0;
  }
}
Voter.prototype.returnBlockVote   = function returnBlockVote() {
  // indifferent so we can include all transactions
  return 0;
}



