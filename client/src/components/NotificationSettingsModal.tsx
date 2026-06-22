import { X, Bell, Volume2, Package, RefreshCw } from 'lucide-react';
import { useNotifications } from '../contexts/NotificationContext';
import { clsx } from 'clsx';

interface NotificationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NotificationSettingsModal({ isOpen, onClose }: NotificationSettingsModalProps) {
  const { settings, updateSettings, forceCheck, connectionState } = useNotifications();

  if (!isOpen) return null;

  const settingItems = [
    {
      key: 'enabled',
      label: '启用通知',
      description: '接收包更新的实时推送通知',
      icon: Bell,
    },
    {
      key: 'soundEnabled',
      label: '通知声音',
      description: '收到新通知时播放提示音',
      icon: Volume2,
      disabled: !settings.enabled,
    },
    {
      key: 'showUpdates',
      label: '显示弹窗',
      description: '收到新通知时在屏幕右上角显示弹出窗口',
      icon: Package,
      disabled: !settings.enabled,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Bell size={20} className="text-white" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900">通知设置</h2>
              <p className="text-xs text-slate-500">管理通知偏好和行为</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="mb-6 p-4 bg-slate-50 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600">连接状态</span>
                <span className={clsx(
                  'text-xs px-2 py-0.5 rounded-full font-medium',
                  connectionState === 'connected' ? 'bg-green-100 text-green-700' :
                  connectionState === 'disconnected' ? 'bg-red-100 text-red-700' :
                  'bg-yellow-100 text-yellow-700'
                )}>
                  {connectionState === 'connected' ? '已连接' :
                   connectionState === 'disconnected' ? '已断开' :
                   connectionState === 'reconnecting' ? '重连中' : '连接中'}
                </span>
              </div>
              <button
                onClick={() => forceCheck()}
                className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                <RefreshCw size={12} />
                立即检查更新
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {settingItems.map((item) => {
              const Icon = item.icon;
              const isDisabled = item.disabled;
              const value = settings[item.key as keyof typeof settings] as boolean;

              return (
                <div
                  key={item.key}
                  className={clsx(
                    'flex items-start gap-4 p-4 rounded-xl border transition-all',
                    isDisabled
                      ? 'bg-slate-50 border-slate-200 opacity-60'
                      : 'bg-white border-slate-200 hover:border-indigo-200'
                  )}
                >
                  <div className={clsx(
                    'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                    isDisabled ? 'bg-slate-200 text-slate-400' : 'bg-indigo-100 text-indigo-600'
                  )}>
                    <Icon size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className={clsx(
                      'font-medium text-sm mb-0.5',
                      isDisabled ? 'text-slate-400' : 'text-slate-900'
                    )}>
                      {item.label}
                    </h4>
                    <p className={clsx(
                      'text-xs',
                      isDisabled ? 'text-slate-400' : 'text-slate-500'
                    )}>
                      {item.description}
                    </p>
                  </div>
                  <button
                    onClick={() => !isDisabled && updateSettings({ [item.key]: !value })}
                    disabled={isDisabled}
                    className={clsx(
                      'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                      value && !isDisabled ? 'bg-indigo-600' : 'bg-slate-300',
                      isDisabled && 'cursor-not-allowed',
                      !isDisabled && 'cursor-pointer hover:opacity-90'
                    )}
                  >
                    <span className={clsx(
                      'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform',
                      value && 'translate-x-5'
                    )} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <p className="text-xs text-amber-700">
              <strong>提示：</strong> 通知设置保存在本地浏览器中，不会同步到服务器。
              版本检查每小时自动运行一次，也可以点击上方按钮手动检查。
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
