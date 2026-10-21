import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi, type GroupRoster } from '../api';
import { groupMemberDisplayName } from '../utils/groupMemberDisplay';
import { useT } from '../i18n';

const PICKER_PAGE_SIZE = 25;

export function GroupMemberPicker({
  groupId,
  selectedTelegramIds,
  onSelectionChange
}: {
  groupId: string;
  selectedTelegramIds: string[];
  onSelectionChange: (ids: string[]) => void;
}) {
  const t = useT();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ['envelope-group-members', groupId, search, offset],
    enabled: Boolean(groupId),
    queryFn: () => adminApi<GroupRoster>(
      `/api/admin/groups/${encodeURIComponent(groupId)}/members?activeOnly=true&limit=${PICKER_PAGE_SIZE}&offset=${offset}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`
    )
  });
  const members = query.data?.members ?? [];
  const selected = new Set(selectedTelegramIds);
  const pageIds = members.map((member) => member.telegramId);
  const pageFullySelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / PICKER_PAGE_SIZE)) : 1;
  const page = Math.floor(offset / PICKER_PAGE_SIZE) + 1;

  const toggleMember = (telegramId: string) => {
    onSelectionChange(selected.has(telegramId)
      ? selectedTelegramIds.filter((id) => id !== telegramId)
      : [...selectedTelegramIds, telegramId]);
  };
  const togglePage = () => {
    if (pageFullySelected) {
      const visibleIds = new Set(pageIds);
      onSelectionChange(selectedTelegramIds.filter((id) => !visibleIds.has(id)));
    } else {
      onSelectionChange([...new Set([...selectedTelegramIds, ...pageIds])]);
    }
  };

  return <section className="audience-member-picker">
    <div className="picker-header">
      <div><strong>{t('chooseEligibleMembers')}</strong><p>{t('selectedMemberCount', selectedTelegramIds.length)}</p></div>
      <button type="button" className="refresh-button" onClick={() => void query.refetch()}>{t('refreshRoster')}</button>
    </div>
    <p className="picker-note">{t('eligibleMembersNote')}</p>
    <div className="picker-toolbar">
      <label className="search-box"><span>⌕</span><input aria-label={t('searchGroupMembers')} placeholder={t('searchGroupMembers')} value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} /></label>
      {members.length > 0 && <button type="button" className="table-action" onClick={togglePage}>{pageFullySelected ? t('clearThisPage') : t('selectThisPage')}</button>}
    </div>
    {query.isError && <div className="alert danger">{(query.error as Error).message}</div>}
    <div className="picker-member-list">
      {query.isLoading && <p className="directory-state">{t('loadingMembers')}</p>}
      {!query.isLoading && members.map((member) => {
        const displayName = groupMemberDisplayName(member);
        const username = member.username?.replace(/^@/, '');
        const usernameDetails = username && displayName !== `@${username}` ? `@${username} · ` : '';
        return <label className="picker-member" key={member.id}>
          <input type="checkbox" checked={selected.has(member.telegramId)} onChange={() => toggleMember(member.telegramId)} />
          <span className="picker-check" aria-hidden="true" />
          <span className="picker-profile"><strong>{displayName}</strong><small>{usernameDetails}{member.telegramId}</small></span>
          {member.isPremium && <span className="premium-tag">{t('premium')}</span>}
          <small className="picker-last-seen">{t('lastSeenShort', new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(member.lastSeenAt)))}</small>
        </label>;
      })}
      {!query.isLoading && query.data?.total === 0 && <p className="directory-state">{search.trim() ? t('noGroupMembersMatch') : t('noObservedMembers')}</p>}
    </div>
    {query.data && query.data.total > 0 && <div className="picker-pagination">
      <span>{t('showingMembers', offset + 1, Math.min(offset + PICKER_PAGE_SIZE, query.data.total), query.data.total)}</span>
      <div className="row-actions"><button type="button" className="table-action" disabled={page <= 1} onClick={() => setOffset(Math.max(0, offset - PICKER_PAGE_SIZE))}>{t('previousPage')}</button><small>{t('pageOf', page, totalPages)}</small><button type="button" className="table-action" disabled={page >= totalPages} onClick={() => setOffset(offset + PICKER_PAGE_SIZE)}>{t('nextPage')}</button></div>
    </div>}
  </section>;
}
