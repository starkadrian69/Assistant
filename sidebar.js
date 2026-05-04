const chatBox = document.getElementById("chatBox");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const resetBtn = document.getElementById("resetBtn");

const GROQ_API_KEY = "REDACTED"; // 👈 paste your key
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_RESPONSES_URL = "https://api.groq.com/openai/v1/responses";
const GROQ_PRIMARY_TEXT_MODEL = "openai/gpt-oss-120b";
const GROQ_FALLBACK_TEXT_MODEL = "openai/gpt-oss-20b";

let activeQuestionNumber = null;

// ─────────────────────────────────────────
// UI
// ─────────────────────────────────────────
function addMsg(text, type = "bot") {
  const div = document.createElement("div");
  div.className = `msg ${type}`;
  div.innerText = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function showWelcome() {
  addMsg("👋 Hello!\n• 'do all questions' → MCQs\n• 'solve c++' → DSA\n• 'solve python' → Python", "bot");
}

function resetChat() {
  chatBox.innerHTML = "";
  userInput.value = "";
  activeQuestionNumber = null;
  showWelcome();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─────────────────────────────────────────
// GROQ AI
// ─────────────────────────────────────────
async function askGroq(prompt, model = GROQ_PRIMARY_TEXT_MODEL, maxTokens = 2000) {
  const runRequest = async (selectedModel) => {
    const isGptOss = selectedModel.startsWith("openai/gpt-oss-");

    const res = await fetch(isGptOss ? GROQ_RESPONSES_URL : GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify(
        isGptOss
          ? {
              model: selectedModel,
              input: prompt,
              max_output_tokens: maxTokens,
              reasoning: { effort: "low" }
            }
          : {
              model: selectedModel,
              messages: [{ role: "user", content: prompt }],
              max_tokens: maxTokens,
              temperature: 0
            }
      )
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    if (isGptOss) {
      const directText = data.output_text?.trim();
      if (directText) return directText;

      const nestedText = (data.output || [])
        .flatMap((item) => item?.content || [])
        .filter((item) => item?.type === "output_text" && typeof item.text === "string")
        .map((item) => item.text)
        .join("\n")
        .trim();

      if (nestedText) return nestedText;

      throw new Error("Empty text response from model");
    }

    const chatText = data.choices?.[0]?.message?.content?.trim();
    if (!chatText) {
      throw new Error("Empty text response from model");
    }
    return chatText;
  };

  try {
    return await runRequest(model);
  } catch (e) {
    if (model === GROQ_PRIMARY_TEXT_MODEL) {
      console.log(`Primary model failed, retrying with ${GROQ_FALLBACK_TEXT_MODEL}:`, e.message);
      return runRequest(GROQ_FALLBACK_TEXT_MODEL);
    }
    throw e;
  }
}

// ─────────────────────────────────────────
// EXEC IN FRAMES
// ─────────────────────────────────────────
function execInFrames(func, args = []) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id, allFrames: true },
        func,
        args
      }, (results) => {
        if (chrome.runtime.lastError) {
          console.log("execInFrames error:", chrome.runtime.lastError.message);
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }

        const frameResults = (results ?? []).map((r) => r.result);
        const successfulResults = frameResults.filter((result) => result?.success === true);
        const successfulObject = successfulResults
          .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
        if (successfulObject) {
          resolve(successfulObject);
          return;
        }

        const truthyBoolean = frameResults.find((result) => result === true);
        if (truthyBoolean === true) {
          resolve(true);
          return;
        }

        const usefulObject = frameResults.find((result) =>
          result &&
          typeof result === "object" &&
          result.error === undefined &&
          result.success !== false
        );
        if (usefulObject) {
          resolve(usefulObject);
          return;
        }

        const valid = frameResults.find((result) =>
          result !== null && result !== undefined && result !== false
        );
        resolve(valid ?? { error: "No result from any frame" });
      });
    });
  });
}

function execInFramesMain(func, args = []) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id, allFrames: true },
        world: "MAIN",
        func,
        args
      }, (results) => {
        if (chrome.runtime.lastError) {
          console.log("execInFramesMain error:", chrome.runtime.lastError.message);
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }

        const frameResults = (results ?? []).map((r) => r.result);
        const successfulResults = frameResults.filter((result) => result?.success === true);
        const successfulObject = successfulResults
          .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
        if (successfulObject) {
          resolve(successfulObject);
          return;
        }

        const valid = frameResults.find((result) =>
          result !== null && result !== undefined && result !== false
        );
        resolve(valid ?? { success: false });
      });
    });
  });
}

// ─────────────────────────────────────────
// SCREENSHOT
// ─────────────────────────────────────────
function takeScreenshot() {
  return new Promise((resolve) => {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.log("Direct screenshot error:", chrome.runtime.lastError.message);

        // Fall back to background messaging if direct capture is unavailable.
        chrome.runtime.sendMessage({ action: "captureTab" }, (response) => {
          console.log("Screenshot response:", response);
          if (chrome.runtime.lastError) {
            console.log("Screenshot error:", chrome.runtime.lastError.message);
            addMsg("❌ Screenshot failed. Reload the extension in chrome://extensions and reopen the side panel.", "error");
            resolve(null);
          } else if (response?.error) {
            console.log("Screenshot response error:", response.error);
            addMsg(`❌ Screenshot error: ${response.error}`, "error");
            resolve(null);
          } else if (!response?.dataUrl) {
            addMsg("⚠️ Screenshot returned empty", "error");
            resolve(null);
          } else {
            console.log("Screenshot success via background! Size:", response?.dataUrl?.length);
            resolve(response.dataUrl);
          }
        });
        return;
      }

      console.log("Screenshot response:", { dataUrl });
      if (!dataUrl) {
        addMsg("⚠️ Screenshot returned empty", "error");
        resolve(null);
      } else {
        console.log("Screenshot success! Size:", dataUrl.length);
        resolve(dataUrl);
      }
    });
  });
}

// ─────────────────────────────────────────
// SCROLL & MULTI SCREENSHOT
// ─────────────────────────────────────────
async function scrollIframeToTop() {
  return execInFrames(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const scrollables = [...document.querySelectorAll("*")].filter(el => {
      const s = window.getComputedStyle(el);
      return (s.overflowY === "auto" || s.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight;
    });
    scrollables.forEach(el => el.scrollTop = 0);
    return true;
  });
}

async function scrollIframeDown(amount) {
  return execInFrames((scrollAmount) => {
    window.scrollBy(0, scrollAmount);
    const scrollables = [...document.querySelectorAll("*")].filter(el => {
      const s = window.getComputedStyle(el);
      return (s.overflowY === "auto" || s.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight;
    });
    scrollables.forEach(el => el.scrollBy(0, scrollAmount));
    return true;
  }, [amount]);
}

async function captureFullProblem() {
  const screenshots = [];

  await scrollIframeToTop();
  await sleep(1000);

  let lastHeight = 0;

  while (true) {
    const ss = await takeScreenshot();
    if (ss) screenshots.push(ss);

    const newHeight = await execInFrames(() => {
      const el = document.scrollingElement;
      const prev = el.scrollTop;
      el.scrollBy(0, window.innerHeight);
      return { newTop: el.scrollTop, prev };
    });

    await sleep(1000);

    if (!newHeight || newHeight.newTop === newHeight.prev) break;
    lastHeight = newHeight.newTop;
  }

  await scrollIframeToTop();
  return screenshots;
}

// ─────────────────────────────────────────
// VISION AI - READ PROBLEM FROM SCREENSHOTS
// ─────────────────────────────────────────
async function readProblemFromScreenshots(screenshots) {
  const imageContents = screenshots.map(dataUrl => ({
    type: "image_url",
    image_url: { url: dataUrl }
  }));

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        {
          role: "user",
          content: [
            ...imageContents,
            {
              type: "text",
              text: `These ${screenshots.length} screenshots show a coding problem page scrolled progressively.
Extract the COMPLETE problem including:
- Problem title
- Full description
- Input Format
- Output Format
- Constraints
- Sample Input and Output
Return only the extracted problem text, nothing else.`
            }
          ]
        }
      ],
      max_tokens: 2000
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content?.trim();
}

// ─────────────────────────────────────────
// PASTE CODE INTO ACE EDITOR
// ─────────────────────────────────────────
async function pasteCode(code) {
  const mainWorldResult = await execInFramesMain((codeText) => {
    const normalized = codeText.replace(/\r\n/g, "\n").trim();
    const aceRoot = document.querySelector(".ace_editor");
    const aceEditor = aceRoot?.env?.editor || (window.ace && aceRoot ? window.ace.edit(aceRoot) : null);
    if (aceEditor && aceRoot) {
      aceEditor.focus();
      aceEditor.setValue(codeText, -1);
      aceEditor.clearSelection?.();
      aceEditor.renderer?.updateFull?.();
      const actual = (aceEditor.getValue?.() || "").replace(/\r\n/g, "\n").trim();
      return { success: actual === normalized, method: "ace-main", priority: 200 };
    }

    if (window.monaco?.editor?.getEditors) {
      const editors = window.monaco.editor.getEditors();
      if (editors.length > 0) {
        editors[0].focus();
        editors[0].setValue(codeText);
        const actual = (editors[0].getValue?.() || "").replace(/\r\n/g, "\n").trim();
        return { success: actual === normalized, method: "monaco-main", priority: 190 };
      }
    }

    const hiddenAceInput = document.querySelector("textarea.ace_text-input");
    if (hiddenAceInput) {
      hiddenAceInput.focus();
      hiddenAceInput.value = codeText;
      hiddenAceInput.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        data: codeText,
        inputType: "insertText"
      }));
      return { success: true, method: "ace-input", priority: 120 };
    }

    return { success: false };
  }, [code]);

  if (mainWorldResult?.success) {
    return mainWorldResult;
  }

  return execInFrames((codeText) => {
    const clickElement = (el) => {
      el.focus?.();
      ["mousedown", "mouseup", "click"].forEach((type) => {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      });
    };

    const triggerTextEvents = (el) => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const normalized = codeText.replace(/\r\n/g, "\n").trim();

    const aceRoot = document.querySelector(".ace_editor");
    const aceEditor = aceRoot?.env?.editor || (window.ace && aceRoot ? window.ace.edit(aceRoot) : null);
    if (aceEditor && aceRoot) {
      clickElement(aceRoot);
      aceEditor.focus();
      aceEditor.selectAll?.();
      aceEditor.session?.setValue?.("");
      aceEditor.setValue(codeText, -1);
      aceEditor.clearSelection();
      aceEditor.renderer?.updateFull?.();
      const actual = (aceEditor.getValue?.() || "").replace(/\r\n/g, "\n").trim();
      return { success: actual === normalized, method: "ace", priority: 100 };
    }

    if (window.monaco?.editor?.getEditors) {
      const editors = window.monaco.editor.getEditors();
      if (editors.length > 0) {
        editors[0].focus();
        editors[0].setValue("");
        editors[0].setValue(codeText);
        const actual = (editors[0].getValue?.() || "").replace(/\r\n/g, "\n").trim();
        return { success: actual === normalized, method: "monaco", priority: 90 };
      }
    }

    const textarea = document.querySelector("textarea:not(.ace_text-input), textarea.ace_text-input");
    if (textarea) {
      clickElement(textarea);
      textarea.value = "";
      textarea.value = codeText;
      textarea.selectionStart = textarea.value.length;
      textarea.selectionEnd = textarea.value.length;
      triggerTextEvents(textarea);
      const actual = (textarea.value || "").replace(/\r\n/g, "\n").trim();
      return { success: actual === normalized, method: "textarea", priority: 10 };
    }

    const editable = document.querySelector('[contenteditable="true"]');
    if (editable) {
      clickElement(editable);
      editable.textContent = "";
      editable.textContent = codeText;
      triggerTextEvents(editable);
      const actual = (editable.textContent || "").replace(/\r\n/g, "\n").trim();
      return { success: actual === normalized, method: "contenteditable", priority: 20 };
    }

    return { success: false };
  }, [code]);
}

// ─────────────────────────────────────────
// SWITCH LANGUAGE
// ─────────────────────────────────────────
async function switchLanguage(lang) {
  const normalize = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();
  const target = normalize(lang);
  const languageLabels = ["c++", "python", "java", "c", "javascript"];

  const clickResult = await execInFrames((targetLang, labels) => {
    const normalizeText = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();
    const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const clickElement = (el) => {
      el.focus?.();
      ["pointerdown", "mousedown", "mouseup", "click"].forEach((type) => {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      });
    };

    const elements = [...document.querySelectorAll("button, [role='button'], [role='option'], [role='menuitem'], li, span, div")];
    const exactTarget = elements.find((el) => isVisible(el) && normalizeText(el.innerText || "") === targetLang);
    if (exactTarget) {
      clickElement(exactTarget);
      return { success: true, method: "exact" };
    }

    const trigger = elements.find((el) => {
      if (!isVisible(el)) return false;
      const text = normalizeText(el.innerText || "");
      return labels.includes(text) || el.getAttribute("aria-haspopup") === "listbox" || el.getAttribute("role") === "combobox";
    });

    if (trigger) {
      clickElement(trigger);
    }

    const option = [...document.querySelectorAll("*")].find((el) =>
      isVisible(el) && normalizeText(el.innerText || "") === targetLang
    );
    if (option) {
      clickElement(option);
      return { success: true, method: trigger ? "dropdown-option" : "exact-after-scan" };
    }

    const partial = [...document.querySelectorAll("*")].find((el) =>
      isVisible(el) && normalizeText(el.innerText || "").includes(targetLang)
    );
    if (partial) {
      clickElement(partial);
      return { success: true, method: "partial" };
    }

    return { success: false };
  }, [target, languageLabels]);

  if (clickResult?.success) {
    return clickResult;
  }

  await sleep(500);

  return execInFrames((targetLang) => {
    const normalizeText = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();
    const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const clickElement = (el) => {
      el.focus?.();
      ["pointerdown", "mousedown", "mouseup", "click"].forEach((type) => {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      });
    };

    for (const el of document.querySelectorAll("*")) {
      if (isVisible(el) && normalizeText(el.innerText || "") === targetLang) {
        clickElement(el);
        return { success: true, method: "retry-exact" };
      }
    }

    return { success: false };
  }, [target]);
}

// ─────────────────────────────────────────
// PAGE ACTIONS
// ─────────────────────────────────────────
async function clickPageAction(labels) {
  return execInFrames((targetLabels) => {
    const normalize = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();
    const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const clickElement = (el) => {
      el.focus?.();
      ["pointerdown", "mousedown", "mouseup", "click"].forEach((type) => {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      });
    };

    const wanted = targetLabels.map(normalize);
    const candidates = [...document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit'], a")];

    const exact = candidates.find((el) => {
      if (!isVisible(el)) return false;
      const text = normalize(el.innerText || el.value || el.getAttribute("aria-label") || "");
      return wanted.includes(text);
    });
    if (exact) {
      clickElement(exact);
      return { success: true, method: "exact", text: exact.innerText || exact.value || "" };
    }

    const partial = candidates.find((el) => {
      if (!isVisible(el)) return false;
      const text = normalize(el.innerText || el.value || el.getAttribute("aria-label") || "");
      return wanted.some((label) => text.includes(label));
    });
    if (partial) {
      clickElement(partial);
      return { success: true, method: "partial", text: partial.innerText || partial.value || "" };
    }

    return { success: false };
  }, [labels]);
}

async function clickSubmitButton() {
  return execInFrames(() => {
    const normalize = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();
    const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const clickElement = (el) => {
      el.scrollIntoView({ block: "center", inline: "nearest" });
      el.focus?.();
      ["pointerdown", "mousedown", "mouseup", "click"].forEach((type) => {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      });
    };

    const candidates = [...document.querySelectorAll("button, input[type='button'], input[type='submit']")]
      .filter((el) => isVisible(el))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = normalize(el.innerText || el.value || el.getAttribute("aria-label") || "");
        return { el, rect, text };
      })
      .filter((item) => item.text === "submit" || item.text === "submit code" || item.text === "final submit");

    if (candidates.length === 0) {
      return { success: false };
    }

    candidates.sort((a, b) => {
      if (b.rect.bottom !== a.rect.bottom) return b.rect.bottom - a.rect.bottom;
      return b.rect.right - a.rect.right;
    });

    clickElement(candidates[0].el);
    return {
      success: true,
      method: "submit-button",
      text: candidates[0].text
    };
  });
}

async function autoSubmitAndNext() {
  addMsg("📤 Submitting solution...", "bot");
  let submitResult = { success: false };
  for (let attempt = 1; attempt <= 3; attempt++) {
    submitResult = await clickSubmitButton();
    if (submitResult?.success) break;
    await sleep(1500);
  }

  if (!submitResult?.success) {
    addMsg("⚠️ Submit button not found", "error");
    return { success: false, stage: "submit" };
  }

  addMsg(`✅ Submitted! (${submitResult.text || submitResult.method})`, "success");
  await sleep(5000);

  addMsg("➡️ Opening the next question from the problem list...", "bot");
  const targetQuestionNumber = Number.isInteger(activeQuestionNumber) ? activeQuestionNumber + 1 : null;
  let nextResult = { success: false };
  for (let attempt = 1; attempt <= 5; attempt++) {
    nextResult = await clickNextQuestionFromList(targetQuestionNumber);
    if (nextResult?.success) break;
    await sleep(1500);
  }

  if (nextResult?.success) {
    addMsg(`✅ Opened next question! (${nextResult.text || nextResult.method})`, "success");
    return {
      success: true,
      nextOpened: true,
      nextQuestionNumber: nextResult.questionNumber ?? targetQuestionNumber
    };
  }

  addMsg("⚠️ Submitted, but the next question in the left problem list was not found", "bot");
  return { success: true, stage: "submitted_only", nextOpened: false };
}

async function getCurrentQuestionNumberFromList() {
  return execInFrames(() => {
    const normalize = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();
    const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const parseNumber = (text) => {
      const match = (text || "").trim().match(/^(\d+)\./);
      return match ? Number(match[1]) : null;
    };

    const rawCandidates = [...document.querySelectorAll("*")]
      .filter((el) => {
        if (!isVisible(el)) return false;
        const text = normalize(el.innerText || "");
        const rect = el.getBoundingClientRect();
        return /^\d+\.\s+/.test(text) && rect.width > 120 && rect.height >= 24 && rect.left < window.innerWidth * 0.35;
      });

    const candidates = rawCandidates.filter((el) => {
      const text = normalize(el.innerText || "");
      return !rawCandidates.some((other) =>
        other !== el &&
        el.contains(other) &&
        normalize(other.innerText || "") === text
      );
    }).sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return aRect.top - bRect.top;
    });

    if (candidates.length === 0) {
      return { success: false };
    }

    const numberedItems = candidates
      .map((el) => ({
        el,
        num: parseNumber(el.innerText || "")
      }))
      .filter((item) => item.num !== null)
      .sort((a, b) => a.num - b.num);

    if (numberedItems.length === 0) {
      return { success: false };
    }

    const titleText = normalize(
      document.querySelector("h1, h2, h3, [class*='title']")?.innerText || ""
    );
    if (titleText.length > 3) {
      const exactTitleMatch = numberedItems.find((item) => {
        const rowText = normalize(item.el.innerText || "");
        const withoutNumber = rowText.replace(/^\d+\.\s*/, "");
        return withoutNumber === titleText || rowText.includes(titleText);
      });
      if (exactTitleMatch) {
        return { success: true, questionNumber: exactTitleMatch.num, method: "title-match" };
      }
    }

    const selectedItem = candidates.find((el) => {
      const className = (el.className || "").toString().toLowerCase();
      return (
        el.getAttribute("aria-current") === "true" ||
        el.getAttribute("aria-selected") === "true" ||
        className.includes("active") ||
        className.includes("selected") ||
        className.includes("current")
      );
    });
    if (selectedItem) {
      const selectedNumber = parseNumber(selectedItem.innerText || "");
      if (selectedNumber !== null) {
        return { success: true, questionNumber: selectedNumber, method: "selected-row" };
      }
    }

    return { success: true, questionNumber: numberedItems[0].num, method: "first-visible" };
  });
}

async function clickNextQuestionFromList(targetQuestionNumber) {
  return execInFrames((targetNum) => {
    const normalize = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();
    const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const clickElement = (el) => {
      el.scrollIntoView({ block: "nearest" });
      el.focus?.();
      ["pointerdown", "mousedown", "mouseup", "click"].forEach((type) => {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      });
    };
    const parseNumber = (text) => {
      const match = (text || "").trim().match(/^(\d+)\./);
      return match ? Number(match[1]) : null;
    };

    const rawCandidates = [...document.querySelectorAll("*")]
      .filter((el) => {
        if (!isVisible(el)) return false;
        const text = normalize(el.innerText || "");
        const rect = el.getBoundingClientRect();
        return /^\d+\.\s+/.test(text) && rect.width > 120 && rect.height >= 24 && rect.left < window.innerWidth * 0.35;
      });

    const candidates = rawCandidates.filter((el) => {
      const text = normalize(el.innerText || "");
      return !rawCandidates.some((other) =>
        other !== el &&
        el.contains(other) &&
        normalize(other.innerText || "") === text
      );
    }).sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return aRect.top - bRect.top;
    });

    const numberedItems = candidates
      .map((el) => ({
        el,
        num: parseNumber(el.innerText || "")
      }))
      .filter((item) => item.num !== null)
      .sort((a, b) => a.num - b.num);

    const nextItem = numberedItems.find((item) => item.num === targetNum);
    if (!nextItem) {
      return { success: false };
    }

    clickElement(nextItem.el);
    return {
      success: true,
      method: "problem-list",
      text: (nextItem.el.innerText || "").trim(),
      questionNumber: nextItem.num
    };
  }, [targetQuestionNumber]);
}

// ─────────────────────────────────────────
// MCQ FUNCTIONS
// ─────────────────────────────────────────
async function getQuestionDirect() {
  return execInFrames(() => {
    const q = document.querySelector("div.md-view p");
    if (!q) return null;
    const labels = document.querySelectorAll("div[role='radiogroup'] label");
    const options = [];
    labels.forEach((l, i) => {
      const t = l.querySelector("div.md-view p");
      if (t) options.push({ index: i, text: t.innerText.trim() });
    });
    return options.length ? { question: q.innerText.trim(), options } : null;
  });
}

async function clickAnswerDirect(answerText) {
  return execInFrames((ans) => {
    const labels = document.querySelectorAll("div[role='radiogroup'] label");
    for (let label of labels) {
      const t = label.querySelector("div.md-view p");
      if (!t) continue;
      const lt = t.innerText.trim().toLowerCase();
      const at = ans.toLowerCase();
      if (lt === at || lt.includes(at) || at.includes(lt)) {
        const radio = label.querySelector("input[type='radio']");
        if (radio) radio.click();
        label.click();
        return true;
      }
    }
    return false;
  }, [answerText]);
}

async function clickNextDirect() {
  return execInFrames(() => {
    const btns = document.querySelectorAll("button");
    for (let btn of btns) {
      if (btn.innerText.trim().toLowerCase() === "next") {
        btn.click();
        return true;
      }
    }
    return false;
  });
}

// ─────────────────────────────────────────
// MCQ LOOP
// ─────────────────────────────────────────
async function doAllQuestions() {
  addMsg("🚀 Starting MCQ automation...", "bot");
  let questionNumber = 1;
  let lastQuestion = "";

  while (true) {
    addMsg(`📖 Reading question ${questionNumber}...`, "bot");
    await sleep(1200);

    const data = await getQuestionDirect();
    if (!data || data.error) {
      addMsg(`⚠️ ${data?.error || "Unknown error"}`, "error");
      break;
    }
    if (data.question === lastQuestion) {
      addMsg(`🎉 Done! Completed ${questionNumber - 1} questions.`, "success");
      break;
    }
    lastQuestion = data.question;

    addMsg(`❓ Q${questionNumber}: ${data.question}`, "bot");
    addMsg("🤖 Getting answer...", "bot");

    let answer;
    try {
      const optionsList = data.options.map((o, i) => `${i + 1}. ${o.text}`).join("\n");
      answer = await askGroq(
        `Answer this MCQ. Reply with ONLY the exact text of the correct option, nothing else.\n\nQuestion: ${data.question}\nOptions:\n${optionsList}`
      );
    } catch (e) {
      addMsg("❌ Groq error: " + e.message, "error");
      break;
    }

    if (!answer) { addMsg("❌ No answer", "error"); break; }
    addMsg(`✅ Answer: ${answer}`, "success");
    await clickAnswerDirect(answer);
    addMsg(`🖱️ Clicked!`, "success");
    await sleep(1500);
    await clickNextDirect();
    addMsg(`➡️ Next...`, "bot");
    questionNumber++;
    await sleep(2000);
  }
}

// ─────────────────────────────────────────
// CODING SOLVER
// ─────────────────────────────────────────
async function solveCodingProblem(language) {
  const langDisplay = language === "cpp" ? "C++" : "Python";
  activeQuestionNumber = null;
  const detectedQuestion = await getCurrentQuestionNumberFromList();
  if (detectedQuestion?.success && Number.isInteger(detectedQuestion.questionNumber)) {
    activeQuestionNumber = detectedQuestion.questionNumber;
    addMsg(`📍 Starting from question ${activeQuestionNumber} (${detectedQuestion.method})`, "bot");
  } else if (!Number.isInteger(activeQuestionNumber)) {
    activeQuestionNumber = 1;
    addMsg("📍 Could not detect current question, defaulting to question 1", "bot");
  }

  while (true) {
    addMsg(`🚀 Solving question ${activeQuestionNumber} in ${langDisplay}...`, "bot");
    let problemText;

    // Step 1: Multi screenshot
    addMsg("📸 Capturing full problem...", "bot");
    const screenshots = await captureFullProblem();

    if (screenshots.length === 0) {
      addMsg("❌ Screenshots failed — check console for errors", "error");
      return;
    }
    addMsg(`✅ Captured ${screenshots.length} screenshots!`, "success");

    // Step 2: Vision AI reads problem
    addMsg("👁️ AI reading problem from screenshots...", "bot");
    try {
      problemText = await readProblemFromScreenshots(screenshots);
    } catch (e) {
      addMsg("❌ Vision error: " + e.message, "error");
      return;
    }

    if (!problemText) {
      addMsg("❌ Could not extract problem", "error");
      return;
    }
    addMsg("✅ Problem extracted!", "success");

    // Step 3: Generate code
    addMsg("🤖 Generating solution...", "bot");
    const langInstructions = language === "cpp"
      ? "Write complete C++ solution. Use #include<bits/stdc++.h> and int main(). Read from cin, write to cout."
      : "Write complete Python solution. Use input() and print().";

    let code;
    try {
      code = await askGroq(
        `You are an expert competitive programmer.\n${langInstructions}\nReturn ONLY raw code, no markdown, no backticks.\n\nProblem:\n${problemText}`
      );
      code = code.replace(/```cpp|```python|```c\+\+|```/g, "").trim();
    } catch (e) {
      addMsg("❌ Code gen error: " + e.message, "error");
      return;
    }

    addMsg("✅ Code generated!", "success");
    addMsg(`📝 ${code.substring(0, 100)}...`, "bot");

    // Step 4: Switch language
    addMsg(`🔄 Switching to ${langDisplay}...`, "bot");
    const switchResult = await switchLanguage(langDisplay);
    if (switchResult?.success) {
      addMsg(`✅ Language switched! (${switchResult.method})`, "success");
    } else {
      addMsg(`⚠️ Could not confirm language switch to ${langDisplay}`, "error");
    }
    await sleep(2000);

    // Step 5: Paste
    addMsg("📋 Pasting into editor...", "bot");
    let pasteResult = { success: false };
    for (let attempt = 1; attempt <= 3; attempt++) {
      pasteResult = await pasteCode(code);
      if (pasteResult?.success) break;
      console.log(`Paste attempt ${attempt} failed:`, pasteResult);
      await sleep(1000);
    }

    if (!pasteResult?.success) {
      try {
        await navigator.clipboard.writeText(code);
        addMsg("📋 Code copied to clipboard!", "success");
        addMsg("👆 Click editor → Ctrl+A → Ctrl+V to paste", "bot");
      } catch (e) {
        addMsg("❌ Direct paste failed and clipboard copy was blocked", "error");
      }
      return;
    }

    addMsg(`✅ Pasted! (${pasteResult.method})`, "success");
    await sleep(1500);
    const submitFlowResult = await autoSubmitAndNext();
    if (!submitFlowResult?.success || !submitFlowResult?.nextOpened) {
      if (submitFlowResult?.success) {
        addMsg("🏁 No more questions detected. Stopping automation.", "success");
      }
      return;
    }

    activeQuestionNumber = submitFlowResult.nextQuestionNumber ?? (activeQuestionNumber + 1);
    await sleep(3000);
  }
}

// ─────────────────────────────────────────
// INPUT HANDLER
// ─────────────────────────────────────────
sendBtn.addEventListener("click", async () => {
  const text = userInput.value.trim().toLowerCase();
  if (!text) return;
  addMsg(text, "user");
  userInput.value = "";

  if (text.includes("do all questions") || text.includes("mcq")) {
    await doAllQuestions();
  } else if (text.includes("solve c++") || text.includes("solve cpp") || text.includes("dsa")) {
    await solveCodingProblem("cpp");
  } else if (text.includes("solve python") || text.includes("python")) {
    await solveCodingProblem("python");
  } else {
    addMsg("💡 Commands:\n• 'do all questions' → MCQs\n• 'solve c++' → DSA\n• 'solve python' → Python", "bot");
  }
});

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendBtn.click();
});

resetBtn.addEventListener("click", () => {
  resetChat();
});

showWelcome();
