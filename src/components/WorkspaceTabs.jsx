import { useEffect, useRef } from 'react';
import WorkspaceContext from './WorkspaceContext.jsx';

const safeId = (value) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-');

export const workspaceTabId = (scope, tabId) => `${safeId(scope)}-tab-${safeId(tabId)}`;
export const workspacePanelId = (scope, tabId) => `${safeId(scope)}-panel-${safeId(tabId)}`;

/**
 * المبدّل الموحّد لمساحات العمل.
 * التبويبات تبقى داخل الصفحة (لا تتكرر في الجانبية)، وتعمل بلوحة المفاتيح
 * وبتمرير أفقي ثابت على الجوال.
 */
export default function WorkspaceTabs({
  scope,
  title,
  subtitle,
  tabs,
  activeId,
  onChange,
  tone = 'var(--brand)',
  showContext = true,
}) {
  const refs = useRef([]);
  const activeTab = tabs.find(tab => tab.id === activeId) || tabs[0];
  const useCompactSelector = tabs.length > 3;

  // في الجوال قد يكون التبويب المختار خارج الجزء الظاهر من الشريط الأفقي
  // عند الدخول برابط مباشر. أبقه مرئياً دائمًا بدل إظهار أيقونة مقصوصة فقط.
  useEffect(() => {
    const activeIndex = tabs.findIndex(tab => tab.id === activeTab?.id);
    const node = refs.current[activeIndex];
    if (!node) return;
    node.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
  }, [activeTab?.id, tabs.length]);

  const moveFocus = (currentIndex, key) => {
    if (!tabs.length) return;
    let nextIndex = currentIndex;
    if (key === 'Home') nextIndex = 0;
    if (key === 'End') nextIndex = tabs.length - 1;
    if (key === 'ArrowRight') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (key === 'ArrowLeft') nextIndex = (currentIndex + 1) % tabs.length;
    const next = tabs[nextIndex];
    if (!next) return;
    onChange(next.id);
    refs.current[nextIndex]?.focus();
  };

  return (
    <>
      <section className="workspace-switcher" style={{ '--workspace-tone': tone }}>
        <div className="workspace-switcher__copy">
          <span className="workspace-switcher__eyebrow">مساحة عمل</span>
          <div>
            <strong>{title}</strong>
            {subtitle && <small>{subtitle}</small>}
          </div>
        </div>

        <label className={`workspace-view-select${useCompactSelector ? ' is-primary' : ''}`}>
          <span>طريقة العرض</span>
          <select value={activeTab?.id || ''} onChange={event => onChange(event.target.value)} aria-label={`العرض داخل ${title}`}>
            {tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
          </select>
        </label>

        <div className={`workspace-tabs${useCompactSelector ? ' is-condensed' : ''}`} role="tablist" aria-label={`أقسام ${title}`}>
          {tabs.map((tab, index) => {
            const Icon = tab.icon;
            const active = tab.id === activeTab?.id;
            return (
              <button
                key={tab.id}
                ref={node => { refs.current[index] = node; }}
                id={workspaceTabId(scope, tab.id)}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={workspacePanelId(scope, tab.id)}
                tabIndex={active ? 0 : -1}
                className={`workspace-tab${active ? ' is-active' : ''}`}
                onClick={() => onChange(tab.id)}
                onKeyDown={(event) => {
                  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  moveFocus(index, event.key);
                }}
              >
                <span className="workspace-tab__icon" aria-hidden="true"><Icon size={16}/></span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {showContext ? <WorkspaceContext tab={activeTab}/> : null}
    </>
  );
}
