export type ToastVariant = 'error' | 'success' | 'warning';

export interface ToastService {
  show(title: string, message: string, variant: ToastVariant): void;
}

export function showToast(
  title: string,
  message: string,
  variant: ToastVariant
): void {
  const toast = document.createElement('div');
  const color =
    variant === 'success'
      ? 'bg-green-500'
      : variant === 'warning'
        ? 'bg-amber-500'
        : 'bg-red-500';
  const iconName =
    variant === 'success'
      ? 'check-circle'
      : variant === 'warning'
        ? 'alert-triangle'
        : 'alert-circle';

  toast.setAttribute('role', variant === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', variant === 'error' ? 'assertive' : 'polite');
  toast.className =
    'fixed top-4 right-4 ' +
    color +
    ' text-white px-4 py-3 rounded-lg shadow-lg z-50 max-w-md';

  const content = document.createElement('div');
  content.className = 'flex items-start gap-3';

  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', iconName);
  icon.className = 'h-5 w-5 flex-shrink-0 mt-0.5';

  const text = document.createElement('div');
  text.className = 'flex-1';

  const heading = document.createElement('p');
  heading.className = 'font-semibold';
  heading.textContent = title;

  const body = document.createElement('p');
  body.className = 'text-sm mt-1';
  body.textContent = message;

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Dismiss ' + title + ' notification');
  dismiss.className = 'text-white/80 hover:text-white';

  const dismissIcon = document.createElement('i');
  dismissIcon.setAttribute('data-lucide', 'x');
  dismissIcon.className = 'h-4 w-4';
  dismiss.appendChild(dismissIcon);
  dismiss.addEventListener('click', () => toast.remove());

  text.appendChild(heading);
  text.appendChild(body);
  content.appendChild(icon);
  content.appendChild(text);
  content.appendChild(dismiss);
  toast.appendChild(content);
  document.body.appendChild(toast);
  window.lucide?.createIcons();

  setTimeout(() => toast.remove(), 5000);
}

const toastService: ToastService = {
  show: showToast,
};

export default toastService;
