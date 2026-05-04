// content.js - handles everything including iframe reading

console.log("ByteXL Assistant loaded on:", window.location.href);

// If this script is running INSIDE the iframe, handle messages
if (window.location.href.includes("bytexl.app/test")) {
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    if (request.action === "getQuestions") {
      try {
        const questionEl = document.querySelector("div.md-view p");
        if (!questionEl) {
          sendResponse({ error: "Question element not found" });
          return true;
        }
        
        const question = questionEl.innerText.trim();
        const labels = document.querySelectorAll("div[role='radiogroup'] label");
        const options = [];
        
        labels.forEach((label, index) => {
          const textEl = label.querySelector("div.md-view p");
          if (textEl) {
            options.push({ index, text: textEl.innerText.trim() });
          }
        });
        
        if (options.length === 0) {
          sendResponse({ error: "No options found" });
          return true;
        }
        
        sendResponse({ question, options });
      } catch (e) {
        sendResponse({ error: e.message });
      }
      return true;
    }

    if (request.action === "clickAnswer") {
      try {
        const labels = document.querySelectorAll("div[role='radiogroup'] label");
        let clicked = false;

        // Exact match first
        for (let label of labels) {
          const textEl = label.querySelector("div.md-view p");
          if (textEl && textEl.innerText.trim().toLowerCase() === request.answerText.toLowerCase()) {
            const radio = label.querySelector("input[type='radio']");
            if (radio) radio.click();
            label.click();
            clicked = true;
            break;
          }
        }

        // Fuzzy match fallback
        if (!clicked) {
          for (let label of labels) {
            const textEl = label.querySelector("div.md-view p");
            if (textEl) {
              const t = textEl.innerText.trim().toLowerCase();
              const a = request.answerText.toLowerCase();
              if (t.includes(a) || a.includes(t)) {
                const radio = label.querySelector("input[type='radio']");
                if (radio) radio.click();
                label.click();
                clicked = true;
                break;
              }
            }
          }
        }

        sendResponse({ success: clicked });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }

    if (request.action === "clickNext") {
      try {
        const buttons = document.querySelectorAll("button");
        for (let btn of buttons) {
          if (btn.innerText.trim().toLowerCase() === "next") {
            btn.click();
            sendResponse({ success: true });
            return true;
          }
        }
        sendResponse({ success: false });
      } catch (e) {
        sendResponse({ success: false });
      }
      return true;
    }

  });
}