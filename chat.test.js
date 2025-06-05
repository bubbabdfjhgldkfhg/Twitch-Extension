const {JSDOM} = require('jsdom');

let isSideConversation;
let hasCyrillic;

describe('chat utilities', () => {
  beforeAll(() => {
    const dom = new JSDOM(`<!DOCTYPE html><body></body>`, { url: 'https://example.com/' });
    global.window = dom.window;
    global.document = dom.window.document;
    document.cookie = 'name=currentuser';
    ({isSideConversation, hasCyrillic} = require('./Chat.js'));
  });

  test('isSideConversation detects reply not involving current user', () => {
    const message = document.createElement('div');
    message.setAttribute('aria-label', 'Replying to someone, Sent at 0:00, otheruser: hi');
    message.textContent = 'otheruser: hi';
    expect(isSideConversation(message)).toBe(true);
  });

  test('isSideConversation ignores reply involving current user', () => {
    const message = document.createElement('div');
    message.setAttribute('aria-label', 'Replying to currentuser, Sent at 0:00, otheruser: hi');
    message.textContent = 'currentuser: hi';
    expect(isSideConversation(message)).toBeUndefined();
  });

  test('hasCyrillic detects Cyrillic characters', () => {
    expect(hasCyrillic('Привет')).toBe(true);
    expect(hasCyrillic('hello')).toBe(false);
  });
});
