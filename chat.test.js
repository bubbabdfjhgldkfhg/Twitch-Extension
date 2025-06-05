const {JSDOM} = require('jsdom');

let isSideConversation;
let hasCyrillic;
let clipCardAppearance;

describe('chat utilities', () => {
  beforeAll(() => {
    const dom = new JSDOM(`<!DOCTYPE html><body></body>`, { url: 'https://example.com/' });
    global.window = dom.window;
    global.document = dom.window.document;
    document.cookie = 'name=currentuser';
    ({isSideConversation, hasCyrillic, clipCardAppearance} = require('./Chat.js'));
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

  test('clipCardAppearance hides raw link and removes styles', () => {
    const message = document.createElement('div');
    message.className = 'chat-line__message';

    const span = document.createElement('span');
    span.innerHTML = `
      <a class="link-fragment">https://example.com/clip/123</a>
      <div class="kSugQB">
        <div class="kkNxaA">
          <a><div class="chat-card"></div></a>
        </div>
      </div>`;

    message.appendChild(span);

    clipCardAppearance(message);

    const link = message.querySelector('.link-fragment');
    expect(link.style.display).toBe('none');

    const card = message.querySelector('.chat-card');
    const level2 = card.parentElement.parentElement; // kkNxaA
    const level3 = level2.parentElement; // kSugQB

    expect(level2.style.background).toBe('none');
    expect(level3.style.boxShadow).toBe('none');
    expect(level3.style.border).toBe('none');
  });
});
