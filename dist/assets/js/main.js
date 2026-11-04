/* 立晨电脑服务 · 交互脚本 */
(function () {
  "use strict";

  /* ---------- 移动端菜单 ---------- */
  var toggle = document.querySelector(".menu-toggle");
  var menu = document.querySelector(".mobile-menu");
  if (toggle && menu) {
    var openMenu = function () {
      menu.classList.add("open");
      document.body.style.overflow = "hidden";
    };
    var closeMenu = function () {
      menu.classList.remove("open");
      document.body.style.overflow = "";
    };
    toggle.addEventListener("click", openMenu);
    menu.addEventListener("click", function (e) {
      if (e.target === menu || e.target.closest(".close") || e.target.closest("a")) closeMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu();
    });
  }

  /* ---------- 滚动淡入 ---------- */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && reveals.length) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- 在线报修：提交到 /api/lead，由 Pages Function 推送企业微信 ---------- */
  var form = document.querySelector("#repair-form");
  if (form) {
    var result = document.querySelector("#form-result");
    var resultTitle = document.querySelector("#form-result-title");
    var resultDesc = document.querySelector("#form-result-desc");
    var fallbackBox = document.querySelector("#form-fallback");
    var summaryBox = document.querySelector("#summary-text");
    var submitBtn = form.querySelector('button[type="submit"]');
    var submitText = submitBtn ? submitBtn.textContent : "提交报修信息";

    var pick = function (data, key, empty) {
      var v = (data.get(key) || "").toString().trim();
      return v || empty;
    };

    var buildSummary = function (data) {
      return (
        "【电脑报修】\n" +
        "称呼：" + pick(data, "name", "未填写") + "\n" +
        "电话：" + pick(data, "phone", "未填写") + "\n" +
        "设备类型：" + pick(data, "device", "未选") + "\n" +
        "故障描述：" + pick(data, "issue", "未填写") + "\n" +
        "上门区域：" + pick(data, "area", "未填写")
      );
    };

    var showResult = function (opts) {
      if (!result) return;
      result.hidden = false;
      result.style.background = opts.bg;
      result.style.borderColor = opts.border;
      if (resultTitle) resultTitle.textContent = opts.title;
      if (resultDesc) resultDesc.textContent = opts.desc;
      if (fallbackBox) fallbackBox.hidden = !opts.showFallback;
      if (opts.showFallback && summaryBox) summaryBox.value = opts.summary || "";
      result.scrollIntoView({ behavior: "smooth", block: "center" });
    };

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = new FormData(form);
      var name = pick(data, "name", "");
      var phone = pick(data, "phone", "");
      if (!name || !phone) {
        alert("请填写称呼和联系电话，方便我们回电。");
        var missing = form.querySelector(!name ? "#name" : "#phone");
        if (missing) missing.focus();
        return;
      }
      if (!/^[0-9+\-() ]{6,25}$/.test(phone)) {
        alert("电话看起来不太对，请填手机号或座机号，方便同事回电。");
        var phoneInput = form.querySelector("#phone");
        if (phoneInput) phoneInput.focus();
        return;
      }

      var summary = buildSummary(data);
      var payload = {
        name: name,
        phone: phone,
        device: pick(data, "device", ""),
        issue: pick(data, "issue", ""),
        area: pick(data, "area", ""),
        page: location.pathname + location.search,
        hp_field: pick(data, "hp_field", "")
      };

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "提交中…";
      }

      fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res
            .json()
            .catch(function () { return {}; })
            .then(function (body) { return { res: res, body: body }; });
        })
        .then(function (r) {
          if (r.res.ok && r.body && r.body.ok) {
            showResult({
              bg: "#f2fbf6",
              border: "#c9ecd9",
              title: "已收到，马上安排回电",
              desc: "报修信息已推送到我们的企业微信，工作时间内 5 分钟内会有同事回电。着急的话可以直接拨打 136-0202-8219。",
              showFallback: false
            });
            form.reset();
          } else {
            showResult({
              bg: "#fff8f0",
              border: "#f3d6b3",
              title: "提交没成功，换个方式更快",
              desc:
                "网络或服务暂时不通，信息没有丢掉——复制下面这段发我们微信 136-0202-8219，或直接打电话，一样能马上安排。",
              showFallback: true,
              summary: summary
            });
          }
        })
        .catch(function () {
          showResult({
            bg: "#fff8f0",
            border: "#f3d6b3",
            title: "提交没成功，换个方式更快",
            desc:
              "网络不太稳，信息没有丢掉——复制下面这段发我们微信 136-0202-8219，或直接打电话，一样能马上安排。",
            showFallback: true,
            summary: summary
          });
        })
        .then(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = submitText;
          }
        });
    });

    var copyBtn = document.querySelector("#copy-summary");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        if (!summaryBox) return;
        summaryBox.select();
        try {
          document.execCommand("copy");
          copyBtn.textContent = "已复制 ✓";
          setTimeout(function () { copyBtn.textContent = "复制报修信息"; }, 2000);
        } catch (err) {
          alert("复制失败，请手动选择文本复制。");
        }
      });
    }
  }

  /* ---------- 电话点击统计占位（接入统计工具后可替换） ---------- */
  document.querySelectorAll('a[href^="tel:"]').forEach(function (a) {
    a.addEventListener("click", function () {
      if (window.dataLayer) {
        window.dataLayer.push({ event: "call_click", phone: a.getAttribute("href") });
      }
    });
  });
})();
