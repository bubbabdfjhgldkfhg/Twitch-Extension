// ==UserScript==
// @name         Chat
// @version      0.1
// @description  Cleanup clutter from twitch chat
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Chat.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Chat.js
// @match        *://*.twitch.tv/*
// @exclude      *://*.twitch.tv/videos/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let fadeoutDuration = 20 * 1000;
    let maxVisibleMessages = 15;
    let brightness = 1;
    let currentUser = getCookie('name');
    let observer;

    // Adjust brightness with "+" and "_"
    document.addEventListener('keydown', function(event) {
        if (event.key === '`') {
            event.preventDefault(); // Prevent the backtick from being entered into the text box
            document.querySelector('.chat-wysiwyg-input__editor')?.focus();
        } else if (event.key === '_' && brightness > 0.2) {
            brightness = parseFloat((brightness - 0.1).toFixed(1));
            messageBrightness();
            chatWindowOpacity();
        } else if (event.key === '+' && brightness < 1) {
            brightness = parseFloat((brightness + 0.1).toFixed(1));
            messageBrightness();
            chatWindowOpacity();
        }
    });

    function messageBrightness() {
        getVisibleMessages().forEach(message => {
            message.style.opacity = brightness;
        });
    }

    function chatWindowOpacity() {
        let rightColumn = document.querySelector('.channel-root__right-column');
        if (rightColumn) {
            rightColumn.style.background = `linear-gradient(90deg, rgba(0,0,0,${brightness/2}) 0%, rgba(0,0,0,0.001) 100%)`;
        }
    }

    function getCookie(key) {
        let value = `; ${document.cookie}`;
        let parts = value.split(`; ${key}=`);
        if (parts.length === 2) {
            return parts.pop().split(';').shift();
        }
        return null;
    }

    // TODO: Properly distinguish theater mode
    // Dynamically apply styles to chat input in Twitch theater mode
    async function applyChatInputStyles(chatInputContainer) {
        let setOpacity = (opacityValue) => {
            chatInputContainer.style.opacity = opacityValue;
        };

        let show = () => setOpacity('1');
        let hide = () => setOpacity('0.15');

        hide();
        // Set opacity before transition so it doesnt flash
        await new Promise(resolve => setTimeout(resolve, 0));
        chatInputContainer.style.transition = 'opacity .5s';

        // Add event listeners for focus and hover to adjust opacity
        chatInputContainer.addEventListener('mouseenter', show);
        chatInputContainer.addEventListener('mouseleave', hide);
        chatInputContainer.addEventListener('focusin', show);
        chatInputContainer.addEventListener('focusout', hide);
    }

    async function fadeOverflowMessages(chatContainer) {
        await new Promise(resolve => setTimeout(resolve, 0));

        let visibleMessages = getVisibleMessages();
        let numMessagesToFade = Math.max(0, visibleMessages.length - maxVisibleMessages);

        setTimeout(() => { // Needs to run slightly after fadeInScheduleFadeOut so the opacity doesnt get overridden
            for (let i = 0; i < numMessagesToFade; i++) {
                let oldestMessage = visibleMessages[i];
                oldestMessage.style.transition = 'opacity .5s ease-in-out';
                oldestMessage.style.opacity = '0';
            }
        }, 10);
    }

    function getVisibleMessages() {
        let chatMessages = observer.targetElement.querySelectorAll('.chat-line__message');
        return Array.from(chatMessages).filter(message => message.style.opacity !== '0' && message.style.display !== 'none');
    }

    function fadeInScheduleFadeOut(message) {
        // Fade in
        message.style.opacity = '0';
        setTimeout(() => {
            message.style.transition = 'opacity .5s ease-in-out, background .5s ease-in-out';
            message.style.transition = 'opacity .5s ease-in-out';
            message.style.opacity = brightness;
            message.style.setProperty('padding', '.5rem 1.3rem', 'important');
        }, 0);

        // Schedule fade out
        setTimeout(() => {
            message.style.transition = 'opacity 1s ease-in-out';
            message.style.opacity = '0';
        }, fadeoutDuration);
    }

    // Remove ugly global badges & identify streamers
    async function hideBadgesAndColorNames(message) {
        // Some badges don't load immediately
        await new Promise(resolve => setTimeout(resolve, 0));

        let usernameElement = message.querySelector('.chat-author__display-name');
        let badges = message.querySelectorAll('.chat-badge');
        for (let element of badges) {
            let altAttr = element.getAttribute('alt');
            if (!altAttr.match(/Subscriber|Founder|Verified|Broadcaster|VIP|Moderator|Bot/)) {
                element.remove();
                break;
            }

            // Highlight Mod/VIP/Broadcaster names so ugly badges can be hidden
            if (altAttr.match(/Broadcaster|VIP|Moderator/)) {
                element.style.setProperty('display', 'none', 'important');
                usernameElement.style.setProperty('color', 'white', 'important');

                if (altAttr.match(/Broadcaster/)) {
                    usernameElement.style.setProperty('background-color', '#ff0000', 'important');
                } else if (altAttr.match(/VIP/)) {
                    usernameElement.style.setProperty('background-color', '#b3008f', 'important');
                } else if (altAttr.match(/Moderator/)) {
                    usernameElement.style.setProperty('background-color', '#008800', 'important');
                }
            }
        }
    }

    function isSideConversation(message) {
        let streamer = window.location.pathname.substring(1);
        // Hide replies and mentions that aren't to/from the current user
        let isReply = message.querySelector('p[title^="Reply"]');
        if (isReply && !isReply.textContent.includes(currentUser)) {
            return true;
        }
        let mentionFragment = message.querySelector('.mention-fragment');
        if (mentionFragment &&
            mentionFragment.textContent.toLowerCase() != ('@' + streamer) &&
            !mentionFragment.classList.contains('mention-fragment--recipient') &&
            !mentionFragment.classList.contains('mention-fragment--sender')) {
            return true;
        }
        return;
    }

    function hasUnwantedEmote(message) {
        // Under construction
        return;
    }

    async function hideDuplicateEmotes(message) {
        // Wait for BTTV to insert emotes
        await new Promise(resolve => setTimeout(resolve, 0));

        let emoteButtons = message.querySelectorAll('.chat-line__message--emote-button, .bttv-emote');
        let seenEmotes = {};

        // Hide subsequent duplicate emotes
        emoteButtons.forEach(emoteButton => {
            let emoteImg = emoteButton.querySelector('img');
            let altText = emoteImg.getAttribute('alt');
            if (seenEmotes[altText]) {
                emoteButton.style.display = 'none';
            } else {
                seenEmotes[altText] = true;
            }
        });
    }

    function clipCardAppearance(message) {
        // Hide clip card background/borders and URL
        // twitch.tv##.chat-card:upward(2):style(background: none !important)
        // twitch.tv##.chat-card:upward(3):style(box-shadow: none !important; border: none !important)
        // twitch.tv##.chat-line__message:has(.chat-card) .link-fragment
    }

    function newMessageHandler(message) {
        fadeInScheduleFadeOut(message);

        // Hide the red line in chat that just says "New" || Hide bits
        if (message.querySelector('.live-message-separator-line__hr') ||
            message.querySelector('.chat-line__message--cheer-amount')) {
            message.style.setProperty('display', 'none', 'important');
            return;
        }

        let streamer = window.location.pathname.substring(1);
        let usernameElement = message.querySelector('.chat-author__display-name');
        let username = usernameElement?.textContent;
        let textElement = message.querySelector('.text-fragment');
        let text = textElement ? textElement.textContent : '';

        if (username.includes(currentUser || streamer) || text?.includes(currentUser)) return;

        if (isSideConversation(message) || hasUnwantedEmote(message)) {
            message.style.display = 'none';
            return;
        }

        // Hide chat commands (Messages that start with '!')
        if (text.startsWith('!')) {
            message.style.display = 'none';
            return;
        }

        hideBadgesAndColorNames(message);
        hideDuplicateEmotes(message);
        clipCardAppearance(message);
    }

    function chatObserver(chatContainer) {
        let observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.classList.contains('chat-line__message')) {
                                newMessageHandler(node);
                                fadeOverflowMessages(chatContainer);
                            }
                            let chatInput = node.querySelector('.chat-input');
                            if (chatInput) {
                                applyChatInputStyles(chatInput);
                            }
                        }
                    });
                }
            });
        });
        let config = { childList: true, subtree: true };
        observer.observe(chatContainer, config);
        return observer;
    }

    // Detect when the chat shell is added to the DOM, self destruct when found
    let pageObserver = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    let chatContainer = node.querySelector('.chat-shell');
                    if (chatContainer) {
                        pageObserver.disconnect();
                        // console.log('Chat shell was found by the observer');
                        chatShellFound(chatContainer);
                    }
                }
            });
        });
    });

    // Check if chatShell already loaded, create observer otherwise
    let chatContainer = document.querySelector('.chat-shell')
    if (chatContainer) {
        // console.log('Chat shell was found early');
        chatShellFound(chatContainer);
    } else {
        pageObserver.observe(document.body, { childList: true, subtree: true });
    }

    // Set initial appearance and create message observer
    function chatShellFound(chatContainer) {
        chatContainer.querySelectorAll('.chat-line__message').forEach(message => newMessageHandler(message));
        chatWindowOpacity();
        observer = chatObserver(chatContainer);
        observer.targetElement = chatContainer;
    }
})();
