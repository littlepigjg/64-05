import { useState, useEffect, useRef } from 'react';
import { Bell, Check, Trash2, Settings, RefreshCw, Package, ArrowRight, Clock, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useNotifications } from '../contexts/NotificationContext';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import type { Notification } from '../types';

interface NotificationCenterProps {
  onOpenSettings?: () => void;
}

export default function NotificationCenter({ onOpenSettings }: NotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const {
    notifications,
    unreadCount,
    connectionState,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
    forceCheck,
    isLoading,
  } = useNotifications();
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read) {
      await markAsRead(notification.id);
    }
    if (notification.type === 'package_update') {
      const { registry, packageName } = notification.data;
      navigate(`/packages/${registry}/${encodeURIComponent(packageName)}`);
    }
    setIsOpen(false);
  };

  const registryColors: Record<string, string> = {
    npm: 'bg-red-500',
    pypi: 'bg-blue-500',
  };

  const registryLabels: Record<string, string> = {
    npm: 'NPM',
    pypi: 'PyPI',
  };

  const connectionStatus = {
    connected: { icon: Wifi, color: 'text-green-500', label: '已连接' },
    connecting: { icon: Loader2, color: 'text-yellow-500 animate-spin', label: '连接中...' },
    reconnecting: { icon: Loader2, color: 'text-yellow-500 animate-spin', label: '重连中...' },
    disconnected: { icon: WifiOff, color: 'text-red-500', label: '已断开' },
  };

  const status = connectionStatus[connectionState];
  const StatusIcon = status.icon;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-900">通知中心</h3>
              <div className="flex items-center gap-1 text-xs">
                <StatusIcon size={12} className={status.color} />
                <span className={status.color}>{status.label}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => forceCheck()}
                className="p-1.5 hover:bg-slate-200 rounded-md text-slate-500 hover:text-slate-700 transition-colors"
                title="立即检查更新"
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={() => onOpenSettings?.()}
                className="p-1.5 hover:bg-slate-200 rounded-md text-slate-500 hover:text-slate-700 transition-colors"
                title="通知设置"
              >
                <Settings size={14} />
              </button>
            </div>
          </div>

          {unreadCount > 0 && (
            <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                {unreadCount} 条未读通知
              </span>
              <button
                onClick={() => markAllAsRead()}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
              >
                <Check size={12} />
                全部已读
              </button>
            </div>
          )}

          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-slate-400" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Bell size={48} className="mb-2 opacity-50" />
                <p className="text-sm">暂无通知</p>
                <p className="text-xs mt-1">当有包更新时会在这里显示</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {notifications.slice(0, 20).map((notification) => (
                  <div
                    key={notification.id}
                    className={clsx(
                      'p-4 cursor-pointer transition-colors group',
                      notification.read ? 'bg-white hover:bg-slate-50' : 'bg-indigo-50/50 hover:bg-indigo-50'
                    )}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="flex items-start gap-3">
                      <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', registryColors[notification.data.registry])}>
                        <Package size={16} className="text-white" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                            {registryLabels[notification.data.registry]}
                          </span>
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Clock size={10} />
                            {formatTime(notification.createdAt)}
                          </span>
                          {!notification.read && (
                            <span className="w-2 h-2 bg-indigo-500 rounded-full flex-shrink-0" />
                          )}
                        </div>
                        <h4 className={clsx('text-sm font-medium mb-0.5', notification.read ? 'text-slate-700' : 'text-slate-900')}>
                          {notification.title}
                        </h4>
                        <p className="text-xs text-slate-500 mb-1">{notification.message}</p>
                        <div className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span>查看详情</span>
                          <ArrowRight size={10} />
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNotification(notification.id);
                        }}
                        className="p-1 hover:bg-red-100 rounded text-slate-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                        title="删除通知"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <button
                onClick={() => navigate('/notifications')}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                查看全部 {notifications.length} 条
              </button>
              <button
                onClick={() => clearAll()}
                className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1"
              >
                <Trash2 size={12} />
                清空所有
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} 天前`;

  return new Date(timestamp).toLocaleDateString();
}
