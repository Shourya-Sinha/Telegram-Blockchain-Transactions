import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi, type GroupRoster, type GroupSetting } from '../api';
import { groupMemberDisplayName } from '../utils/groupMemberDisplay';
import { useT } from '../i18n';

const PAGE_SIZE = 50;
const dateTime = (value: string) => new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

export function GroupsPage() {
  const t = useT();
  const [selectedChatId, setSelectedChatId] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const groupsQuery = useQuery({
    queryKey: ['admin-groups'],
    queryFn: () => adminApi<GroupSetting[]>('/api/admin/groups')
  });
  const groups = groupsQuery.data ?? [];
  const selectedGroup = groups.find((group) => group.chatId === selectedChatId) ?? groups[0];
  const rosterQuery = useQuery({
    queryKey: ['admin-group-members', selectedGroup?.chatId, search, offset],
    enabled: Boolean(selectedGroup),
    queryFn: () => adminApi<GroupRoster>(
      `/api/admin/groups/${encodeURIComponent(selectedGroup!.chatId)}/members?limit=${PAGE_SIZE}&offset=${offset}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`
    )
  });
  const roster = rosterQuery.data;
  const pageCount = roster ? Math.max(1, Math.ceil(roster.total / PAGE_SIZE)) : 1;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const selectGroup = (chatId: string) => {
    setSelectedChatId(chatId);
    setSearch('');
    setOffset(0);
  };

  return <div className="page-content">
    <header className="page-header">
      <div><p className="overline">{t('operationsOverview')}</p><h1>{t('groupDirectoryTitle')}</h1><p>{t('groupDirectorySubtitle')}</p></div>
      <button className="refresh-button" onClick={() => { void groupsQuery.refetch(); void rosterQuery.refetch(); }}>{t('refresh')}</button>
    </header>

    {groupsQuery.isError && <div className="alert danger">{(groupsQuery.error as Error).message}</div>}
    <div className="info-callout group-roster-notice"><strong>{t('telegramRosterLimitationsTitle')}</strong><p>{t('telegramRosterLimitations')}</p></div>

    <div className="group-directory">
      <section className="panel group-directory-list">
        <div className="panel-head"><div><h2>{t('registeredGroups')}</h2><p>{t('registeredGroupsNote')}</p></div><span className="group-total">{groups.length}</span></div>
        {groupsQuery.isLoading && <p className="directory-state">{t('loadingGroups')}</p>}
        {!groupsQuery.isLoading && groups.length === 0 && <div className="directory-state">{t('noRegisteredGroups')}</div>}
        <div className="group-cards">
          {groups.map((group) => {
            const count = group._count?.members ?? 0;
            const selected = selectedGroup?.chatId === group.chatId;
            return <button type="button" key={group.id} className={`group-card ${selected ? 'selected' : ''}`} onClick={() => selectGroup(group.chatId)}>
              <span className="group-card-icon">▦</span>
              <span className="group-card-main"><strong>{group.title ?? (group.username ? `@${group.username}` : t('unnamedGroup'))}</strong><code>{group.chatId}</code></span>
              <span className="group-card-count"><strong>{count}</strong><small>{t('knownMembers')}</small></span>
            </button>;
          })}
        </div>
      </section>

      <section className="panel group-member-panel">
        {!selectedGroup
          ? <div className="directory-state">{t('selectGroupToViewMembers')}</div>
          : <>
            <div className="panel-head group-member-head">
              <div><h2>{selectedGroup.title ?? (selectedGroup.username ? `@${selectedGroup.username}` : t('unnamedGroup'))}</h2><p>{t('telegramGroupId')}: <code>{selectedGroup.chatId}</code></p></div>
              <span className="group-total">{roster?.total ?? selectedGroup._count?.members ?? 0} {t('knownMembers')}</span>
            </div>
            <div className="group-member-toolbar">
              <label className="search-box"><span>⌕</span><input aria-label={t('searchGroupMembers')} placeholder={t('searchGroupMembers')} value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} /></label>
              <button className="refresh-button" onClick={() => void rosterQuery.refetch()}>{t('refreshRoster')}</button>
            </div>
            {rosterQuery.isError && <div className="alert danger">{(rosterQuery.error as Error).message}</div>}
            <div className="table-panel group-member-table">
              <table><thead><tr><th>{t('colTelegramId')}</th><th>{t('colProfile')}</th><th>{t('colLanguage')}</th><th>{t('colMessagesSeen')}</th><th>{t('colFirstSeen')}</th><th>{t('colLastSeen')}</th><th>{t('colMemberStatus')}</th></tr></thead>
                <tbody>{roster?.members.map((member) => {
                  const displayName = groupMemberDisplayName(member);
                  const usernameLabel = member.username && displayName !== `@${member.username.replace(/^@/, '')}`
                    ? `@${member.username.replace(/^@/, '')}`
                    : t('noUsername');
                  return <tr key={member.id}>
                    <td><code>{member.telegramId}</code></td>
                    <td><div className="group-profile"><strong>{displayName}</strong><small>{usernameLabel}{member.isBot ? ` · ${t('botAccount')}` : ''}{member.isPremium ? ` · ${t('premium')}` : ''}</small></div></td>
                    <td>{member.languageCode ?? '—'}</td>
                    <td>{member.messageCount}</td>
                    <td><small>{dateTime(member.firstSeenAt)}</small></td>
                    <td><small>{dateTime(member.lastSeenAt)}</small></td>
                    <td><span className={`status ${member.isMember ? 'active' : 'banned'}`}>{member.isMember ? t('memberActive') : t('memberLeft')}</span></td>
                  </tr>;
                })}</tbody>
              </table>
              {rosterQuery.isLoading && <div className="directory-state">{t('loadingMembers')}</div>}
              {!rosterQuery.isLoading && roster && roster.members.length === 0 && <div className="directory-state">{t('noGroupMembersMatch')}</div>}
            </div>
            {roster && roster.total > 0 && <div className="pagination-row">
              <span>{t('showingMembers', offset + 1, Math.min(offset + PAGE_SIZE, roster.total), roster.total)}</span>
              <div className="row-actions"><button className="table-action" disabled={currentPage <= 1} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>{t('previousPage')}</button><small>{t('pageOf', currentPage, pageCount)}</small><button className="table-action" disabled={currentPage >= pageCount} onClick={() => setOffset(offset + PAGE_SIZE)}>{t('nextPage')}</button></div>
            </div>}
          </>}
      </section>
    </div>
  </div>;
}
