window.MyMusicsUI = Object.freeze({
  closeDialog(dialog) {
    if (typeof dialog?.close === "function") dialog.close();
    else dialog?.removeAttribute("open");
  }
});

if (!window.HTMLDialogElement || !("closedBy" in window.HTMLDialogElement.prototype)) {
  document.addEventListener("click", (event) => {
    const dialog = event.target;
    if (!dialog.matches?.('dialog[open][closedby="any"]') || event.detail === 0) return;
    const box = dialog.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right
      || event.clientY < box.top || event.clientY > box.bottom;
    if (outside) window.MyMusicsUI.closeDialog(dialog);
  }, true);
}
