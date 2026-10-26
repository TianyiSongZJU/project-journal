import test from 'node:test';
import assert from 'node:assert/strict';
import {isDesktopHost} from '../web/desktop-host.js';

test('native desktop changes are enabled by either host without opting in browser-only sessions',()=>{
  const previous=globalThis.window;
  try {
    delete globalThis.window;assert.equal(isDesktopHost(),false);
    globalThis.window={};assert.equal(isDesktopHost(),false);
    globalThis.window={journalWindowsHost:true};assert.equal(isDesktopHost(),true);
    globalThis.window={journalMacHost:true};assert.equal(isDesktopHost(),true);
  } finally {
    if(previous===undefined)delete globalThis.window;else globalThis.window=previous;
  }
});
