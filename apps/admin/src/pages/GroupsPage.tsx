import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, type GroupRoster, type GroupSetting } from '../api';
import { groupMemberDisplayName } from '../utils/groupMemberDisplay';
import { useT } from '../i18n';

const PAGE_SIZE = 50;
const dateTime = (value: string) => new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
type GroupAction = 'remove' | 'cancel-removal' | 'restore';

export function GroupsPage() {
  const t = useT();
  const client = useQueryClient();
  const [selectedChatId, setSelectedChatId] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [actionTone, setActionTone] = useState<'success' | 'danger' | 'warning'>('success');
  const groupsQuery = useQuery({
    queryKey: ['admin-groups', showArchived],
    queryFn: () => adminApi<GroupSetting[]>(`/api/admin/groups${showArchived ? '?includeArchived=true' : ''}`),
    refetchInterval: 30_000
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
  const groupAction = useMutation({
    mutationFn: ({ chatId, action }: { chatId: string; action: GroupAction }) => adminApi<{ status: string; activeEnvelopes?: number }>(
      action === 'remove'
        ? `/api/admin/groups/${encodeURIComponent(chatId)}`
        : `/api/admin/groups/${encodeURIComponent(chatId)}/${action}`,
      { method: action === 'remove' ? 'DELETE' : 'POST' }
    ),
    onSuccess: (result, variables) => {
      if (variables.action === 'remove' && result.status === 'PENDING') {
        setActionMessage(t('groupRemovalScheduled', result.activeEnvelopes ?? 0));
        setActionTone('warning');
      } else if (variables.action === 'remove') {
        setActionMessage(t('groupRemoved'));
        setActionTone('success');
        setSelectedChatId('');
      } else if (variables.action === 'cancel-removal') {
        setActionMessage(t('groupRemovalCancelled'));
        setActionTone('success');
      } else {
        setActionMessage(t('groupRestored'));
        setActionTone('success');
      }
      void client.invalidateQueries({ queryKey: ['admin-groups'] });
      void client.invalidateQueries({ queryKey: ['admin-group-members'] });
      void client.invalidateQueries({ queryKey: ['envelope-setup'] });
      void client.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: (error) => {
      setActionMessage(error instanceof Error ? error.message : t('unableToUpdateGroup'));
      setActionTone('danger');
    }
  });
  const selectGroup = (chatId: string) => {
    setSelectedChatId(chatId);
    setSearch('');
    setOffset(0);
    setActionMessage('');
  };
  const selectedName = selectedGroup?.title ?? (selectedGroup?.username ? `@${selectedGroup.username}` : t('unnamedGroup'));
  const selectedIsArchived = Boolean(selectedGroup?.archivedAt);
  const selectedIsPendingRemoval = Boolean(selectedGroup?.deletionRequestedAt);
  const performGroupAction = () => {
    if (!selectedGroup) return;
    if (selectedIsPendingRemoval) {
      if (window.confirm(t('confirmCancelGroupRemoval', selectedName))) groupAction.mutate({ chatId: selectedGroup.chatId, action: 'cancel-removal' });
    } else if (selectedIsArchived) {
      if (window.confirm(t('confirmRestoreGroup', selectedName))) groupAction.mutate({ chatId: selectedGroup.chatId, action: 'restore' });
    } else if (window.confirm(t('confirmRemoveGroup', selectedName))) {
      groupAction.mutate({ chatId: selectedGroup.chatId, action: 'remove' });
    }
  };
  const statusText = (group: GroupSetting) => group.archivedAt ? t('groupArchived')
    : group.deletionRequestedAt ? t('groupRemovalPending')
      : group.enabled ? t('groupAvailable') : t('groupDisabled');
  const statusClass = (group: GroupSetting) => group.archivedAt ? 'banned'
    : group.deletionRequestedAt ? 'queued'
      : group.enabled ? 'active' : 'failed';

  return <div className="page-content">
    <header className="page-header">
      <div><p className="overline">{t('operationsOverview')}</p><h1>{t('groupDirectoryTitle')}</h1><p>{t('groupDirectorySubtitle')}</p></div>
      <button className="refresh-button" onClick={() => { void groupsQuery.refetch(); void rosterQuery.refetch(); }}>{t('refresh')}</button>
    </header>

    {groupsQuery.isError && <div className="alert danger">{(groupsQuery.error as Error).message}</div>}
    {actionMessage && <div className={`alert ${actionTone}`}>{actionMessage}</div>}
    <div className="info-callout group-roster-notice"><strong>{t('telegramRosterLimitationsTitle')}</strong><p>{t('telegramRosterLimitations')}</p></div>

    <div className="group-directory">
      <section className="panel group-directory-list">
        <div className="panel-head">
          <div><h2>{t('registeredGroups')}</h2><p>{t('registeredGroupsNote')}</p></div>
          <div className="group-list-actions">
            <button className="refresh-button" onClick={() => setShowArchived((value) => !value)}>{showArchived ? t('hideArchivedGroups') : t('showArchivedGroups')}</button>
            <span className="group-total">{groups.length}</span>
          </div>
        </div>
        {groupsQuery.isLoading && <p className="directory-state">{t('loadingGroups')}</p>}
        {!groupsQuery.isLoading && groups.length === 0 && <div className="directory-state">{showArchived ? t('noArchivedGroups') : t('noRegisteredGroups')}</div>}
        <div className="group-cards">
          {groups.map((group) => {
            const count = group._count?.members ?? 0;
            const selected = selectedGroup?.chatId === group.chatId;
            return <button type="button" key={group.id} className={`group-card ${selected ? 'selected' : ''}`} onClick={() => selectGroup(group.chatId)}>
              <span className="group-card-icon">▦</span>
              <span className="group-card-main"><strong>{group.title ?? (group.username ? `@${group.username}` : t('unnamedGroup'))}</strong><code>{group.chatId}</code></span>
              <span className="group-card-count"><strong>{count}</strong><small>{t('knownMembers')}</small><small className={`status ${statusClass(group)}`}>{statusText(group)}</small></span>
            </button>;
          })}
        </div>
      </section>

      <section className="panel group-member-panel">
        {!selectedGroup
          ? <div className="directory-state">{t('selectGroupToViewMembers')}</div>
          : <>
            <div className="panel-head group-member-head">
              <div><h2>{selectedName}</h2><p>{t('telegramGroupId')}: <code>{selectedGroup.chatId}</code></p></div>
              <div className="group-detail-actions">
                <span className={`status ${statusClass(selectedGroup)}`}>{statusText(selectedGroup)}</span>
                <button className={`table-action ${selectedIsArchived || selectedIsPendingRemoval ? '' : 'danger-action'}`} disabled={groupAction.isPending} onClick={performGroupAction}>
                  {groupAction.isPending ? t('saving') : selectedIsArchived ? t('restoreGroup') : selectedIsPendingRemoval ? t('cancelGroupRemoval') : t('removeGroup')}
                </button>
              </div>
            </div>
            {selectedIsPendingRemoval && <div className="alert warning">{t('groupPendingRemovalNote')}</div>}
            {selectedIsArchived && <div className="info-callout"><strong>{t('groupArchived')}</strong><p>{t('groupArchivedNote')}</p></div>}
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
              {!rosterQuery.isLoading && roster && roster.members.length === 0 && <div className="directory-state">{search.trim() ? t('noGroupMembersMatch') : t('noObservedMembers')}</div>}
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
