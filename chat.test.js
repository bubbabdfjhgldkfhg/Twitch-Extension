const {JSDOM} = require('jsdom');

let isSideConversation;
let hasCyrillic;
let clipCardAppearance;
let newMessageHandler;

describe('chat utilities', () => {
  beforeAll(() => {
    const dom = new JSDOM(`<!DOCTYPE html><body></body>`, { url: 'https://example.com/' });
    global.window = dom.window;
    global.document = dom.window.document;
    document.cookie = 'name=currentuser';
    ({isSideConversation, hasCyrillic, clipCardAppearance, newMessageHandler} = require('./Chat.js'));
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

  test('clipCardAppearance handles real Twitch markup', () => {
    const html = `<div class="chat-line__message">
      <span>
        <a class="link-fragment" href="https://www.twitch.tv/test/clip/abc">https://www.twitch.tv/test/clip/abc</a>
        <div class="kfgjoR">
          <div class="erSjEY">
            <a><div class="chat-card"></div></a>
          </div>
        </div>
      </span>
    </div>`;

    const container = document.createElement('div');
    container.innerHTML = html;
    const message = container.firstElementChild;

    clipCardAppearance(message);

    const link = message.querySelector('.link-fragment');
    expect(link.style.display).toBe('none');

    const card = message.querySelector('.chat-card');
    const level2 = card.parentElement.parentElement; // erSjEY
    const level3 = level2.parentElement; // kfgjoR

    expect(level2.style.background).toBe('none');
    expect(level3.style.boxShadow).toBe('none');
    expect(level3.style.borderStyle).toBe('none');
  });

  test('newMessageHandler leaves long messages unmodified', () => {
    const longText = 'a'.repeat(105);
    const html = `<div class="chat-line__message"><span data-a-target="chat-line-message-body"><span class="text-fragment">${longText}</span></span></div>`;
    const container = document.createElement('div');
    container.innerHTML = html;
    const message = container.firstElementChild;

    newMessageHandler(message);

    const body = message.querySelector('[data-a-target="chat-line-message-body"]');
    expect(body.dataset.truncated).toBeUndefined();
    expect(body.style.textOverflow).toBe('');
  });

  test('newMessageHandler applies difference blend mode to message text', () => {
    const html = `<div class="chat-line__message"><span data-a-target="chat-line-message-body"><span class="text-fragment">hi</span></span></div>`;
    const container = document.createElement('div');
    container.innerHTML = html;
    const message = container.firstElementChild;

    newMessageHandler(message);

    const body = message.querySelector('[data-a-target="chat-line-message-body"]');
    expect(body.style.mixBlendMode).toBe('difference');
    expect(body.style.color).toBe('white');
  });
});
