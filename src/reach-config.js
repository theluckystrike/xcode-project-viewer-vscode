'use strict';
// REACH1: this listing's Pro tools for the viewer toolbar row and the Explorer entries (src/reach.js).
module.exports = {
  prefix: 'xcodeProj',
  triesKey: 'xcodeProj.proTrial',
  slot: '#toolbar',
  tools: [
    { id: 'merge', title: 'Merge conflict helper', command: 'xcodeProj.mergeHelper' },
    { id: 'compare', title: 'Compare two project versions', command: 'xcodeProj.compare' },
    { id: 'settings', title: 'Build settings export and compare', command: 'xcodeProj.buildSettings' },
  ],
};
