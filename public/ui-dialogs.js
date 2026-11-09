window.MyMusicsUI = Object.freeze({
  closeDialog(dialog) {
    if (typeof dialog?.close === "function") dialog.close();
    else dialog?.removeAttribute("open");
  },
  closeOnBackdropClick(dialog) {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog || event.detail === 0) return;
      const box = dialog.getBoundingClientRect();
      const inside = event.clientX >= box.left && event.clientX <= box.right
        && event.clientY >= box.top && event.clientY <= box.bottom;
      if (!inside) dialog.close();
    });
  }
});
