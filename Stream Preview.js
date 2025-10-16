// ==UserScript==
// @name         Stream Preview
// @match        https://www.twitch.tv/*
// @run-at       document-end
// @grant        none
// @description  none
// @version      0.1
// ==/UserScript==

(() => {
    'use strict';

    const VIDEO_WIDTH = 600; // Adjust this single value
    const VIDEO_HEIGHT = Math.round(VIDEO_WIDTH / 1.778); // 16:9 aspect ratio

    const reserved = new Set(["directory","p","settings","downloads","jobs","login","signup","search","videos","subs"]);
    const getChan = (href) => {
        const u = new URL(href, location.origin);
        const seg = u.pathname.split("/").filter(Boolean)[0];
        return (!seg || reserved.has(seg)) ? null : seg.toLowerCase();
    };
    let box, timer, currentAnchor, mouseX = 0, mouseY = 0, currentChannel = null;

    document.addEventListener("mousemove", (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    const show = (a, chan) => {
        if (currentChannel === chan && box && !box.hidden) return;

        currentChannel = chan;

        if (!box) {
            box = document.createElement("div");
            Object.assign(box.style, {
                position: "fixed", zIndex: 999999,
                width: VIDEO_WIDTH + "px",
                height: VIDEO_HEIGHT + "px",
                boxShadow: "0 8px 30px rgba(0,0,0,.35)",
                borderRadius: "10px",
                overflow: "hidden",
                background: "#000"
            });
            document.body.appendChild(box);
        }
        box.style.left = Math.max(8, mouseX - VIDEO_WIDTH) + "px";
        box.style.top  = Math.max(8, mouseY - VIDEO_HEIGHT) + "px";
        const parent = encodeURIComponent(location.hostname);
        const src = `https://player.twitch.tv/?channel=${encodeURIComponent(chan)}&parent=${parent}&muted=true&autoplay=true`;
        const ifr = document.createElement("iframe");
        Object.assign(ifr, { src, width: "100%", height: "100%", frameBorder: "0", allow: "autoplay; fullscreen; picture-in-picture" });
        box.replaceChildren(ifr);
        box.hidden = false;
    };
    const hide = () => {
        clearTimeout(timer);
        currentChannel = null;
        if (box) { box.hidden = true; box.replaceChildren(); }
    };
    const delegate = (e) => {
        const a = e.target.closest("a[href]");
        if (!a) return;
        const chan = a.dataset.channel || getChan(a.href);
        if (!chan) return;
        if (e.type === "mouseenter") {
            currentAnchor = a;
            timer = setTimeout(() => show(a, chan), 200);
        } else if (e.type === "mouseleave" && currentAnchor === a) {
            hide();
        }
    };
    document.addEventListener("mouseenter", delegate, true);
    document.addEventListener("mouseleave", delegate, true);
})();
