import { useEffect } from 'react';
import { X, Package, ArrowRight } from 'lucide-react';
import { useNotifications } from '../contexts/NotificationContext';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';

export default function NotificationToast() {
  const { activeToast, dismissToast, markAsRead } = useNotifications();
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeToast) {
        dismissToast();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeToast, dismissToast]);

  if (!activeToast) return null;

  const handleClick = () => {
    if (activeToast.type === 'package_update') {
      const { registry, packageName } = activeToast.data;
      markAsRead(activeToast.id);
      navigate(`/packages/${registry}/${encodeURIComponent(packageName)}`);
    }
    dismissToast();
  };

  const registryColors: Record<string, string> = {
    npm: 'bg-red-500',
    pypi: 'bg-blue-500',
  };

  const registryLabels: Record<string, string> = {
    npm: 'NPM',
    pypi: 'PyPI',
  };

  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm animate-in slide-in-from-right duration-300">
      <div
        className={clsx(
          'bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden cursor-pointer transition-all hover:shadow-2xl hover:scale-[1.02]',
          'hover:-translate-y-0.5'
        )}
        onClick={handleClick}
      >
          <div className="flex items-start gap-3 p-4">
            <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', registryColors[activeToast.data.registry])}>
              <Package size={20} className="text-white" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {registryLabels[activeToast.data.registry]}
                </span>
                <span className="text-xs text-slate-500">
                  {new Date(activeToast.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <h4 className="font-semibold text-slate-900 mb-0.5">{activeToast.title}</h4>
              <p className="text-sm text-slate-600 mb-2">{activeToast.message}</p>
              {activeToast.data.description && (
                <p className="text-xs text-slate-500 line-clamp-2">{activeToast.data.description}</p>
              )}
              <div className="flex items-center gap-1 mt-2 text-xs font-medium text-indigo-600">
                <span>查看详情</span>
                <ArrowRight size={12} />
              </div>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                dismissToast();
              }}
              className="p-1 hover:bg-slate-100 rounded-md text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
            >
              <X size={16} />
            </button>
          </div>

          <div className="h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 animate-pulse" />
        </div>
    </div>
  );
}
