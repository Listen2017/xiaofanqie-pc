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

  /* ---------- 报修摘要生成（无后端时的兜底方案） ---------- */
  var form = document.querySelector("#repair-form");
  if (form) {
    var result = document.querySelector("#form-result");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = new FormData(form);
      var name = (data.get("name") || "").toString().trim();
      var phone = (data.get("phone") || "").toString().trim();
      if (!name || !phone) {
        alert("请填写称呼和联系电话，方便我们回电。");
        return;
      }
      var summary =
        "【电脑报修】\n" +
        "称呼：" + name + "\n" +
        "电话：" + phone + "\n" +
        "设备类型：" + (data.get("device") || "未选") + "\n" +
        "故障描述：" + ((data.get("issue") || "未填写").toString().trim()) + "\n" +
        "上门区域：" + ((data.get("area") || "未填写").toString().trim());

      if (result) {
        result.hidden = false;
        result.querySelector("textarea").value = summary;
        result.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    var copyBtn = document.querySelector("#copy-summary");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var ta = document.querySelector("#summary-text");
        ta.select();
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
