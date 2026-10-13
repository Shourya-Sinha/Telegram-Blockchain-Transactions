import { Component, type ReactNode } from 'react';
import { useLang } from '../i18n';

const copy = {
  en: { title: 'The wallet hit an unexpected error', text: 'Nothing was lost — your balance and claims are stored on the server. Reload to continue.', reload: 'Reload' },
  zh: { title: '钱包出现意外错误', text: '数据不会丢失 — 余额与领取记录都保存在服务器。重新加载即可继续。', reload: '重新加载' }
};

/**
 * Last line of defence: a render error used to unmount the whole tree, leaving
 * a frozen screen where neither the in-app controls nor Telegram's back arrow
 * did anything. Now the failure is caught and the user always has a way out.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) { return { error }; }

  override componentDidCatch(error: Error, info: unknown) { console.error('[mini-app] render error', error, info); }

  override render() {
    if (!this.state.error) return this.props.children;
    const lang = useLang.getState().lang === 'zh' ? 'zh' : 'en';
    const text = copy[lang];
    return <div className="crash-screen" role="alert">
      <span className="crash-icon">⚠️</span>
      <h2>{text.title}</h2>
      <p>{text.text}</p>
      <code>{this.state.error.message}</code>
      <button className="primary-button" onClick={() => { this.setState({ error: undefined }); window.location.reload(); }}>{text.reload}</button>
    </div>;
  }
}
