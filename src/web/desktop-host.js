// Native hosts opt in before the page's module scripts execute.
export const isDesktopHost = () => typeof window !== 'undefined' && Boolean(window.journalWindowsHost || window.journalMacHost);
