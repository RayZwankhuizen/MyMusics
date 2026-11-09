export function wireMusicDialogEvents({ el, closeOnBackdropClick }) {
  const infoClose = el("#info-close");
  if (infoClose) {
    infoClose.addEventListener("click", () => {
      const infoDialog = el("#info-dialog");
      if (infoDialog && typeof infoDialog.close === "function") infoDialog.close();
    });
  }

  const leftSearchDialog = el("#left-search-dialog");
  const leftSearchClose = el("#left-search-close");
  if (leftSearchClose && leftSearchDialog) {
    leftSearchClose.addEventListener("click", (event) => {
      event.preventDefault();
      window.MyMusicsUI.closeDialog(leftSearchDialog);
    });
  }

  document.querySelectorAll("dialog").forEach(closeOnBackdropClick);
}
