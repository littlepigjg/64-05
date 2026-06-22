import { useState } from 'react';
import { Bell, Check, Trash2, Package, ArrowRight, Clock, Filter, Loader2, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useNotifications } from '../contexts/NotificationContext';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import type { Notification, RegistryType } from '../types';

export default function NotificationsPage() {
  const {
    notifications,
    unreadCount,
    totalCount,
    connectionState,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
    forceCheck,
    loadMore,
    isLoading,
  } = useNotifications();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'unread' | 'npm' | 'pypi'>('all');
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread') return !n.read;
    if (filter === 'npm') return n.data.registry === 'npm';
    if (filter === 'pypi') return n.data.registry === 'pypi';
    return true;
  });

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read) {
      await markAsRead(notification.id);
    }
    if (notification.type === 'package_update') {
      const { registry, packageName } = notification.data;
      navigate(`/packages/${registry}/${encodeURIComponent(packageName)}`);
    }
  };

  const handleLoadMore = async () => {
    if (isLoadingMore || filteredNotifications.length >= totalCount) return;
    setIsLoadingMore(true);
    await loadMore(50);
    setIsLoadingMore(false);
  };

  const registryColors: Record<string, string> = {
    npm: 'bg-red-500',
    pypi: 'bg-blue-500',
  };

  const registryLabels: Record<string, string> = {
    npm: 'NPM',
    pypi: 'PyPI',
  };

  const filters: Array<{ key: typeof filter; label: string; count?: number }> = [
    { key: 'all', label: '全部', count: totalCount },
    { key: 'unread', label: '未读', count: unreadCount },
    { key: 'npm', label: 'NPM', count: notifications.filter(n => n.data.registry === 'npm').length },
    { key: 'pypi', label: 'PyPI', count: notifications.filter(n => n.data.registry === 'pypi').length },
  ];

  const connectionStatus = {
    connected: { icon: Wifi, color: 'text-green-500', label: '实时连接中' },
    connecting: { icon: Loader2, color: 'text-yellow-500 animate-spin', label: '连接中...' },
    reconnecting: { icon: Loader2, color: 'text-yellow-500 animate-spin', label: '重连中...' },
    disconnected: { icon: WifiOff, color: 'text-red-500', label: '已断开' },
  };

  const status = connectionStatus[connectionState];
  const StatusIcon = status.icon;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Bell size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">通知中心</h1>
              <div className="flex items-center gap-2 text-sm">
                <StatusIcon size={14} className={status.color} />
                <span className={status.color}>{status.label}</span>
                <span className="text-slate-400">•</span>
                <span className="text-slate-500">{totalCount} 条通知，{unreadCount} 条未读</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => forceCheck()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            >
              <RefreshCw size={16} />
              检查更新
            </button>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllAsRead()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <Check size={16} />
                全部已读
              </button>
            )}
            {totalCount > 0 && (
              <button
                onClick={() => clearAll()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 size={16} />
                清空
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2">
        <Filter size={16} className="text-slate-400 flex-shrink-0" />
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={clsx(
              'px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap',
              filter === f.key
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            )}
          >
            {f.label}
            {f.count !== undefined && (
              <span className={clsx(
                'ml-1.5 px-1.5 py-0.5 rounded-full text-xs',
                filter === f.key ? 'bg-white/20' : 'bg-slate-200'
              )}>
                {f.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-slate-400" />
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <Bell size={64} className="mb-4 opacity-30" />
          <p className="text-lg font-medium text-slate-500">暂无通知</p>
          <p className="text-sm mt-1">当有包更新时会在这里显示</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredNotifications.map((notification) => (
            <div
              key={notification.id}
              className={clsx(
                'p-4 rounded-xl border transition-all cursor-pointer group',
                notification.read
                  ? 'bg-white border-slate-200 hover:border-indigo-200 hover:shadow-sm'
                  : 'bg-indigo-50/30 border-indigo-100 hover:border-indigo-300 hover:shadow-sm'
              )}
              onClick={() => handleNotificationClick(notification)}
            >
              <div className="flex items-start gap-4">
                <div className={clsx('w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0', registryColors[notification.data.registry])}>
                  <Package size={22} className="text-white" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      {registryLabels[notification.data.registry]}
                    </span>
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Clock size={12} />
                      {formatDateTime(notification.createdAt)}
                    </span>
                    {!notification.read && (
                      <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full flex-shrink-0 animate-pulse" />
                    )}
                  </div>
                  <h3 className={clsx('font-semibold mb-1', notification.read ? 'text-slate-700' : 'text-slate-900')}>
                    {notification.title}
                  </h3>
                  <p className="text-sm text-slate-600 mb-2">{notification.message}</p>
                  {notification.data.description && (
                    <p className="text-xs text-slate-500 line-clamp-2">{notification.data.description}</p>
                  )}
                  <div className="flex items-center gap-1 mt-2 text-sm font-medium text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span>跳转到包详情页</span>
                    <ArrowRight size={14} />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  {!notification.read && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        markAsRead(notification.id);
                      }}
                      className="p-2 hover:bg-green-100 rounded-lg text-slate-400 hover:text-green-600 transition-colors"
                      title="标记为已读"
                    >
                      <Check size={16} />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNotification(notification.id);
                    }}
                    className="p-2 hover:bg-red-100 rounded-lg text-slate-400 hover:text-red-500 transition-colors"
                    title="删除通知"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {filteredNotifications.length < totalCount && (
            <div className="flex justify-center pt-4 pb-8">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    加载中...
                  </>
                ) : (
                  '加载更多'
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDateTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const date = new Date(timestamp);

  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} 天前`;

  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
