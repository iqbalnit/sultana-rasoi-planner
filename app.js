/* रसोई प्लानर — all logic, no dependencies, works offline.
   The title/description/tag rules mirror src/metadata_gen.py and the narration
   rules mirror src/narration.py, so what she gets here matches what the channel
   tooling produces. Everything is kept in localStorage on her own phone. */
(function () {
  "use strict";

  var KEY = "rasoi-planner-v1";
  var QUAL = "आसान घरेलू रेसिपी";
  var SHORTS = " #shorts";
  var MAX_TITLE = 60;
  var HANDLE = "@delicioushomefood3270";
  var SUB_URL = "https://www.youtube.com/" + HANDLE + "?sub_confirmation=1";
  var EVERGREEN = ["bihari recipe", "indian home cooking", "desi recipe", "घरेलू नुस्खे", "easy indian recipe"];
  var SUBSCRIBE_LINE = "ऐसी और रेसिपी के लिए सब्सक्राइब कर लीजिए।";
  var WORDS_PER_SECOND = 2.6;   // measured against rendered Hindi speech

  // Built from escapes so the source stays ASCII and cannot break on a bad encoding.
  var DEVA = new RegExp("[\\u0900-\\u097F]");
  var DEVA_LETTER = new RegExp("[A-Za-z\\u0900-\\u0963\\u0966-\\u097F]");
  var EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;
  var UNITS = ["कप", "चम्मच", "छोटे", "बड़े", "ग्राम", "लीटर", "टेबलस्पून", "tsp", "tbsp", "cup", "ml"];
  // NOTE: no \b here. JavaScript's word boundary is ASCII-only, so "\bकप\b" never
  // matches - Python's \b is Unicode-aware, which is why src/narration.py can use it.
  var MEASURE = new RegExp("[\\d./]+\\s*(" + UNITS.join("|") + ")(?=\\s|$|[,।])", "g");
  var UNIT_WORD = new RegExp("(^|\\s)(" + UNITS.join("|") + ")(?=\\s|$|[,।])", "g");

  var FILM_CHECKS = [
    ["f0", "शुरुआत तैयार डिश से — हिलती हुई", "Open on the finished dish in motion. Not an empty counter, not raw ingredients."],
    ["f1", "नमस्ते और इंट्रो नहीं", "No greeting, no intro, no logo."],
    ["f2", "स्क्रीन पर लिखा — ऊपर की तरफ़", "Text hook in the top third. YouTube's buttons cover the bottom and right."],
    ["f3", "पहले 4 सेकंड में ख़ास बात बताइए", "Say what's different in the first four seconds."],
    ["f4", "पूरे वीडियो में बोलिए", "Talk the whole way through — read the script from step 2."],
    ["f5", "हर शॉट 2 सेकंड से छोटा", "Every shot under two seconds, straight cuts."],
    ["f6", "सब्सक्राइब बीच में बोलिए", "Subscribe line mid-video, not at the end."],
    ["f7", "आख़िरी शॉट = पहला शॉट", "End on the frame you opened with, so it loops."],
    ["f8", "खड़ा (vertical) वीडियो", "Film upright, dish in the middle of the frame."]
  ];

  var UPLOAD_CHECKS = [
    ["u0", "टाइटल पेस्ट किया", "Pasted the title from step 4."],
    ["u1", "डिस्क्रिप्शन पेस्ट किया", "Replaced everything already in the box."],
    ["u2", "टैग पेस्ट किए", "Show more → Tags."],
    ["u3", "Category: Howto & Style", "Not People & Blogs."],
    ["u4", "भाषा: हिंदी", "Video language: Hindi."],
    ["u5", "बच्चों के लिए नहीं", "Audience: not made for kids, or comments switch off."],
    ["u6", "शाम 7 बजे के आसपास", "Publish around 7pm."]
  ];

  var $ = function (id) { return document.getElementById(id); };
  var PLAN_FIELDS = ["dish", "promise", "pillar", "ingredients", "steps_", "prep", "cook", "serves", "tip"];
  var AFTER_FIELDS = ["afterStayed", "afterWatched", "afterViews"];

  // ---------- storage ----------
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || { videos: [] }; }
    catch (e) { return { videos: [] }; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }
  var state = load();
  var activeId = null;

  function active() {
    for (var i = 0; i < state.videos.length; i++) {
      if (state.videos[i].id === activeId) return state.videos[i];
    }
    return null;
  }

  // ---------- shared text helpers ----------
  function cleanDish(s) {
    return (s || "").replace(/[#@]\S*/g, "").replace(/\s*\|+\s*/g, " | ")
      .replace(/\s+/g, " ").trim().replace(/^\|+|\|+$/g, "").trim();
  }
  function titleCase(s) {
    return s.split(" ").map(function (w) {
      if (!w || DEVA.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(" ");
  }
  function lines(s) {
    return (s || "").split(/\n|;/).map(function (x) {
      return x.replace(/^\s*(\d+[.)]|[•\-*])\s*/, "").trim();
    }).filter(Boolean);
  }
  function cleanTag(t) {
    return t.replace(EMOJI, "").replace(/\|/g, " ").replace(/\s{2,}/g, " ").trim();
  }

  // ---------- metadata (mirrors src/metadata_gen.py) ----------
  function buildTitle(dish, promise) {
    var d = titleCase(cleanDish(dish));
    var p = (promise || "").trim();
    var limit = MAX_TITLE - SHORTS.length;
    var t = [d, p || QUAL].join(" | ");
    var dropped = false;
    if (t.length > limit) {
      dropped = !!p;
      t = d;
      if (t.length > limit) {
        var cut = t.slice(0, limit);
        t = cut.indexOf(" | ") !== -1 ? cut.slice(0, cut.lastIndexOf(" | ")) : cut.slice(0, cut.lastIndexOf(" "));
      }
    }
    return { title: t.replace(/[\s|]+$/, "") + SHORTS, dropped: dropped };
  }

  function hashtags(dish, pillar) {
    var slug = dish.toLowerCase().replace(/[^a-z0-9]/g, "");
    var h = [];
    if (slug) h.push("#" + slug);
    h.push("#biharirecipe", "#indianhomecooking");
    if (pillar === "festival") h.push("#festivalrecipe");
    if (pillar === "quick_sweets") h.push("#easysweet");
    h.push("#shorts");
    return h.filter(function (x, i) { return h.indexOf(x) === i; }).join(" ");
  }

  function buildDescription(v) {
    var d = titleCase(cleanDish(v.dish)) || "…";
    var p = (v.promise || "").trim();
    var L = [];
    L.push(p ? d + " — " + p + (DEVA.test(p) ? "।" : ".") : d + " — " + QUAL + "।", "");
    var ing = lines(v.ingredients), st = lines(v.steps_);
    if (!ing.length && !st.length) {
      L.push("पूरी विधि वीडियो में देखिए — हर स्टेप आसान भाषा में।",
             "Full method in the video, step by step.", "");
    }
    if (ing.length) { L.push("सामग्री | Ingredients"); ing.forEach(function (x) { L.push("• " + x); }); L.push(""); }
    if (st.length) { L.push("विधि | Method"); st.forEach(function (x, i) { L.push((i + 1) + ". " + x); }); L.push(""); }
    var meta = [];
    if (v.prep) meta.push("तैयारी | Prep: " + v.prep + " min");
    if (v.cook) meta.push("पकाने का समय | Cook: " + v.cook + " min");
    if (v.serves) meta.push(v.serves + " लोगों के लिए | Serves " + v.serves);
    if (meta.length) L.push(meta.join(" · "), "");
    if ((v.tip || "").trim()) L.push("💡 " + v.tip.trim(), "");
    L.push("──────────",
           "Sultana & Daughter's Kitchen — माँ और बेटी की रसोई से आसान घरेलू रेसिपी।",
           "A mother and daughter cooking simple Indian home food together.", "",
           "नई रेसिपी के लिए सब्सक्राइब करें 👉 " + SUB_URL, "",
           hashtags(d, v.pillar));
    return L.join("\n");
  }

  function buildTags(dish) {
    var base = cleanTag(cleanDish(dish)).toLowerCase();
    var t = [];
    if (base) {
      if (DEVA.test(base)) t.push(base, base + " रेसिपी", base + " बनाने का तरीका");
      else t.push(base, base + " recipe", base + " banane ka tarika",
                  base + " kaise banaye", "easy " + base, "homemade " + base);
    }
    t = t.concat(EVERGREEN).filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 15);
    var out = [], len = 0;    // YouTube caps the tag field at 500 characters
    t.forEach(function (x) { if (len + x.length + 2 <= 500) { out.push(x); len += x.length + 2; } });
    return out;
  }

  // ---------- narration (mirrors src/narration.py) ----------
  function speakableStep(step) {
    var s = step.replace(/\([^)]*\)/g, "").replace(MEASURE, "");
    s = s.replace(/\s+/g, " ").replace(/ ,/g, ",");
    return s.replace(/^[\s।.,]+|[\s।.,]+$/g, "") + "।";
  }

  function ingredientNames(ing) {
    var out = [];
    ing.forEach(function (item) {
      if (/^\s*[—-]/.test(item)) return;              // a group header, not an ingredient
      var name = item.split(/[|,(]/)[0]
        .replace(/^[\d/.\s-]+/, "")
        .replace(UNIT_WORD, "$1")
        .replace(/\s+/g, " ").replace(/[,–—-]+$/, "").trim();
      if (name && out.indexOf(name) === -1) out.push(name);
    });
    return out;
  }

  function buildScript(v) {
    var d = titleCase(cleanDish(v.dish));
    var p = (v.promise || "").trim().replace(/[।.]$/, "");
    var steps = lines(v.steps_).map(speakableStep);
    var names = ingredientNames(lines(v.ingredients));
    var out = [];
    if (!d) return out;
    out.push({ cue: "0–1.5s", kind: "hook", say: p ? d + ", " + p + "।" : d + "।" });
    if (names.length) out.push({ cue: "1.5–4s", kind: "need", say: "चाहिए " + names.slice(0, 4).join(", ") + "।" });
    var mid = Math.max(1, Math.floor(steps.length / 2));
    steps.forEach(function (s, i) {
      if (i === mid) out.push({ cue: "बीच में", kind: "sub", say: SUBSCRIBE_LINE });
      out.push({ cue: "स्टेप " + (i + 1), kind: "step", say: s });
    });
    if (steps.length) out.push({ cue: "आख़िर", kind: "close", say: "तैयार है। ज़रूर बनाइए।" });
    return out;
  }

  function estimateSeconds(script) {
    var words = 0;
    script.forEach(function (l) { words += l.say.split(/\s+/).filter(Boolean).length; });
    return words / WORDS_PER_SECOND;
  }

  // ---------- rendering ----------
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 1800);
  }

  function progressOf(v) {
    var total = FILM_CHECKS.length + UPLOAD_CHECKS.length;
    var done = 0;
    for (var k in (v.checks || {})) { if (v.checks[k]) done++; }
    return { done: done, total: total };
  }

  function renderList() {
    var box = $("videoList");
    box.innerHTML = "";
    state.videos.forEach(function (v) {
      var p = progressOf(v);
      var el = document.createElement("button");
      el.className = "item";
      el.innerHTML =
        '<span class="name"></span>' +
        '<span class="prog' + (p.done === p.total ? " done" : "") + '">' + p.done + "/" + p.total + "</span>" +
        '<span class="meta"></span>';
      el.querySelector(".name").textContent = titleCase(cleanDish(v.dish)) || "बिना नाम का वीडियो";
      var est = estimateSeconds(buildScript(v));
      el.querySelector(".meta").textContent =
        (v.promise ? v.promise + " · " : "") + (est ? Math.round(est) + "s बोलना" : "जानकारी भरना बाक़ी");
      el.addEventListener("click", function () { openVideo(v.id); });
      box.appendChild(el);
    });
    $("emptyState").hidden = state.videos.length > 0;
  }

  function buildChecks(containerId, defs, v) {
    var box = $(containerId);
    box.innerHTML = "";
    defs.forEach(function (c) {
      var lbl = document.createElement("label");
      lbl.className = "check";
      lbl.innerHTML = '<input type="checkbox"><span><span class="hi"></span><span class="en"></span></span>';
      lbl.querySelector(".hi").textContent = c[1];
      lbl.querySelector(".en").textContent = c[2];
      var box2 = lbl.querySelector("input");
      box2.checked = !!(v.checks && v.checks[c[0]]);
      box2.addEventListener("change", function () {
        v.checks = v.checks || {};
        v.checks[c[0]] = box2.checked;
        save(); renderList();
      });
      box.appendChild(lbl);
    });
  }

  function renderScript(v) {
    var script = buildScript(v);
    var box = $("scriptLines");
    box.innerHTML = "";
    if (!script.length) {
      $("fitAdvice").className = "advice";
      $("fitAdvice").innerHTML = "पहले <b>डिश का नाम</b> और <b>विधि</b> भरिए।" +
        '<span class="en">Fill in the dish name and the steps first.</span>';
      return;
    }
    script.forEach(function (l) {
      var row = document.createElement("div");
      row.className = "line" + (l.kind === "sub" ? " sub" : "");
      row.innerHTML = '<span class="cue"></span><span class="say"></span>';
      row.querySelector(".cue").textContent = l.cue;
      row.querySelector(".say").textContent = l.say;
      box.appendChild(row);
    });

    var est = Math.round(estimateSeconds(script));
    var a = $("fitAdvice");
    if (est <= 25) {
      a.className = "advice good";
      a.innerHTML = "<b>लगभग " + est + " सेकंड बोलना है।</b> इसे 20–25 सेकंड का बनाइए।" +
        '<span class="en">Short videos are what work on this channel — the 17–22 second ones were ' +
        "watched to 71–83% and got the most views.</span>";
    } else if (est <= 36) {
      a.className = "advice";
      a.innerHTML = "<b>लगभग " + est + " सेकंड बोलना है।</b> वीडियो 30–35 सेकंड का रखिए।" +
        '<span class="en">Fine, but a 20-second version of a simpler dish tends to reach more people.</span>';
    } else {
      a.className = "advice bad";
      var longest = script.filter(function (l) { return l.kind === "step"; })
        .sort(function (x, y) { return y.say.length - x.say.length; })[0];
      a.innerHTML = "<b>लगभग " + est + " सेकंड — यह लंबा है।</b> या तो " + (est + 2) +
        " सेकंड का वीडियो बनाइए, या सबसे लंबा स्टेप छोटा कीजिए:" +
        '<span class="en" style="margin-top:6px">' + (longest ? longest.say : "") + "</span>";
    }
  }

  function renderPublish(v) {
    var tt = buildTitle(v.dish, v.promise);
    var hasDish = !!(v.dish || "").trim();
    $("outTitle").value = hasDish ? tt.title : "";
    $("outDesc").value = hasDish ? buildDescription(v) : "";
    var tags = hasDish ? buildTags(v.dish) : [];
    $("outTags").value = tags.join(", ");
    $("tagCount").textContent = tags.length ? tags.length + " टैग" : "";

    var n = hasDish ? Array.from(tt.title).length : 0;
    $("titleCount").textContent = n + " अक्षर";
    var m = $("meter");
    m.querySelector("i").style.width = Math.min(n / 80, 1) * 100 + "%";
    m.classList.toggle("over", n > MAX_TITLE);

    var w = [];
    if (!hasDish) w.push(["soft", "पहले डिश का नाम लिखिए।", "Type the dish name first."]);
    if (/[#@]/.test(v.dish || "")) w.push(["", "नाम से # और @ हटा दिए।", "Hashtags and @names removed — they belong in the description, not the title."]);
    if (hasDish && !(v.promise || "").trim()) w.push(["soft", "“ख़ास क्या है” लिखेंगी तो टाइटल बेहतर बनेगा।", "Add what's different and the title gets stronger."]);
    if (tt.dropped) w.push(["", "टाइटल लंबा था — “ख़ास क्या है” हटाना पड़ा।", "Too long, so that part was dropped. Shorten it."]);
    if (hasDish && !lines(v.ingredients).length) w.push(["soft", "सामग्री लिखिए।", "Listing ingredients helps people find the video in search."]);
    $("warns").innerHTML = w.map(function (x) {
      return '<div class="warn ' + x[0] + '">' + x[1] + '<span class="en">' + x[2] + "</span></div>";
    }).join("");
  }

  function renderAfter(v) {
    var a = $("afterVerdict");
    var s = parseFloat(v.afterStayed), wch = parseFloat(v.afterWatched);
    if (isNaN(s) && isNaN(wch)) {
      a.className = "advice";
      a.innerHTML = "48 घंटे बाद Studio में देखकर यहाँ लिखिए।" +
        '<span class="en">Fill these in after two days and this will tell you what to change next.</span>';
      return;
    }
    var msgs = [];
    if (!isNaN(s)) {
      msgs.push(s >= 50 ? "<b>शुरुआत बहुत अच्छी है।</b>"
        : s > 31 ? "<b>शुरुआत पहले से बेहतर है।</b>"
        : "<b>शुरुआत पर काम चाहिए — पहले 2 सेकंड बदलिए।</b>");
    }
    if (!isNaN(wch)) {
      msgs.push(wch >= 60 ? "<b>पूरा देखा जा रहा है।</b>"
        : wch > 42 ? "<b>ठीक है, थोड़ा और छोटा कीजिए।</b>"
        : "<b>बीच में छोड़ रहे हैं — वीडियो छोटा और तेज़ कीजिए।</b>");
    }
    var good = (isNaN(s) || s > 31) && (isNaN(wch) || wch > 42);
    a.className = "advice " + (good ? "good" : "bad");
    a.innerHTML = msgs.join(" ") +
      '<span class="en">Channel baseline: ~31% stay past the opening, and those who stay watch 32–42%.</span>';
  }

  function renderDetail() {
    var v = active();
    if (!v) return;
    $("barTitle").textContent = titleCase(cleanDish(v.dish)) || "नया वीडियो";
    $("barSub").textContent = "रसोई प्लानर";
    renderScript(v);
    renderPublish(v);
    renderAfter(v);
    var est = Math.round(estimateSeconds(buildScript(v)));
    var hint = $("lengthHint");
    if (est) {
      hint.className = "advice" + (est <= 25 ? " good" : "");
      hint.innerHTML = "<b>वीडियो की लंबाई: " + (est <= 25 ? "20–25" : est <= 36 ? "30–35" : (est + 2) + "") +
        " सेकंड</b><span class=\"en\">Based on how long the script takes to say.</span>";
    } else {
      hint.className = "advice";
      hint.innerHTML = "विधि भरने पर यहाँ लंबाई दिखेगी।<span class=\"en\">Fill in the steps to see the target length.</span>";
    }
  }

  // ---------- navigation ----------
  function showList() {
    activeId = null;
    $("detailView").hidden = true;
    $("listView").hidden = false;
    $("back").hidden = true;
    $("barTitle").textContent = "रसोई प्लानर";
    $("barSub").textContent = "Sultana & Daughter's Kitchen";
    renderList();
    window.scrollTo(0, 0);
  }

  function openVideo(id) {
    activeId = id;
    var v = active();
    if (!v) return showList();
    PLAN_FIELDS.forEach(function (f) { $(f).value = v[f] || (f === "pillar" ? "regional" : ""); });
    AFTER_FIELDS.forEach(function (f) { $(f).value = v[f] || ""; });
    buildChecks("filmChecks", FILM_CHECKS, v);
    buildChecks("uploadChecks", UPLOAD_CHECKS, v);
    $("listView").hidden = true;
    $("detailView").hidden = false;
    $("back").hidden = false;
    setStep("plan");
    renderDetail();
    window.scrollTo(0, 0);
  }

  function setStep(name) {
    Array.prototype.forEach.call(document.querySelectorAll("#steps button"), function (b) {
      b.classList.toggle("on", b.dataset.step === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".step"), function (s) {
      s.hidden = s.dataset.panel !== name;
    });
    window.scrollTo(0, 0);
  }

  // ---------- wiring ----------
  $("newVideo").addEventListener("click", function () {
    var v = { id: String(Date.now()), pillar: "regional", checks: {}, created: new Date().toISOString() };
    state.videos.unshift(v);
    save();
    openVideo(v.id);
    $("dish").focus();
  });

  $("back").addEventListener("click", showList);

  Array.prototype.forEach.call(document.querySelectorAll("#steps button"), function (b) {
    b.addEventListener("click", function () { setStep(b.dataset.step); });
  });

  var saveTimer = null;
  PLAN_FIELDS.concat(AFTER_FIELDS).forEach(function (f) {
    $(f).addEventListener("input", function () {
      var v = active();
      if (!v) return;
      v[f] = $(f).value;
      renderDetail();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { save(); renderList(); }, 350);
    });
  });

  // Two taps to delete, so a stray tap never loses a written-up recipe.
  var armed = false, armTimer = null;
  $("deleteVideo").addEventListener("click", function () {
    var b = $("deleteVideo");
    if (!armed) {
      armed = true;
      b.textContent = "फिर से दबाइए — हट जाएगा";
      armTimer = setTimeout(disarm, 3500);
      return;
    }
    clearTimeout(armTimer);
    state.videos = state.videos.filter(function (x) { return x.id !== activeId; });
    save(); disarm(); showList(); toast("वीडियो हटा दिया");
  });
  function disarm() {
    armed = false;
    $("deleteVideo").innerHTML = 'यह वीडियो हटाइए <span class="en-inline">Delete this video</span>';
  }

  function copyText(text, label) {
    var done = function (ok) { toast(ok ? label + " कॉपी हो गया" : "दबाकर रखिए और कॉपी कीजिए"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta); done(ok);
    }
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"), function (b) {
    b.addEventListener("click", function () {
      var el = $(b.dataset.copy);
      if (!el.value) return toast("पहले जानकारी भरिए");
      var head = b.closest(".out").querySelector("h3");
      copyText(el.value, head.firstChild.textContent.trim());
    });
  });

  $("copyScript").addEventListener("click", function () {
    var v = active();
    var script = buildScript(v);
    if (!script.length) return toast("पहले विधि भरिए");
    copyText(script.map(function (l) { return l.say; }).join(" "), "स्क्रिप्ट");
  });

  $("bigRead").addEventListener("click", function () {
    var v = active();
    var script = buildScript(v);
    if (!script.length) return toast("पहले विधि भरिए");
    var box = $("bigText");
    box.innerHTML = "";
    script.forEach(function (l) {
      var d = document.createElement("div");
      d.innerHTML = "<span></span>";
      d.querySelector("span").textContent = l.cue;
      d.appendChild(document.createTextNode(l.say));
      box.appendChild(d);
    });
    $("bigOverlay").hidden = false;
  });
  $("closeBig").addEventListener("click", function () { $("bigOverlay").hidden = true; });

  // ---------- offline ----------
  function setOffline() { $("offline").hidden = navigator.onLine; }
  window.addEventListener("online", setOffline);
  window.addEventListener("offline", setOffline);
  setOffline();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* fine without it */ });
    });
  }

  showList();
})();
