import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi, type GroupRoster } from '../api';
import { groupMemberDisplayName } from '../utils/groupMemberDisplay';
import { useT } from '../i18n';

const PICKER_PAGE_SIZE = 25;
const MAX_ELIGIBLE_RECIPIENTS = 500;

function isValidTelegramId(value: string): boolean {
  return /^\d{1,16}$/.test(value)
    && BigInt(value) > 0n
    && Number.isSafeInteger(Number(value));
}

function normalizeUsername(value: string): string {
  return value.startsWith('@') ? value.slice(1) : value;
}

function isValidTelegramUsername(value: string): boolean {
  return /^[a-zA-Z0-9_]{5,32}$/.test(value);
}

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
  const [manualIdInput, setManualIdInput] = useState('');
  const [manualUsernameInput, setManualUsernameInput] = useState('');
  const [manuallyAddedIds, setManuallyAddedIds] = useState<string[]>([]);
  const [manualRecipientLabels, setManualRecipientLabels] = useState<Record<string, string>>({});
  const [manualIdError, setManualIdError] = useState('');
  const [manualUsernameError, setManualUsernameError] = useState('');
  const [resolvingUsernames, setResolvingUsernames] = useState(false);
  const mountedRef = useRef(true);
  const selectedIdsRef = useRef(selectedTelegramIds);
  selectedIdsRef.current = selectedTelegramIds;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const query = useQuery({
    queryKey: ['envelope-group-members', groupId, search, offset],
    enabled: Boolean(groupId),
    queryFn: () => adminApi<GroupRoster>(
      `/api/admin/groups/${encodeURIComponent(groupId)}/members?activeOnly=true&limit=${PICKER_PAGE_SIZE}&offset=${offset}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`
    )
  });
  const members = query.data?.members ?? [];
  const selected = new Set(selectedTelegramIds);
  const selectedManualIds = manuallyAddedIds.filter((id) => selected.has(id));
  const pageIds = members.map((member) => member.telegramId);
  const pageFullySelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / PICKER_PAGE_SIZE)) : 1;
  const page = Math.floor(offset / PICKER_PAGE_SIZE) + 1;

  const toggleMember = (telegramId: string) => {
    if (!selected.has(telegramId) && selectedTelegramIds.length >= MAX_ELIGIBLE_RECIPIENTS) {
      setManualIdError(t('maxEligibleRecipients', MAX_ELIGIBLE_RECIPIENTS));
      return;
    }
    onSelectionChange(selected.has(telegramId)
      ? selectedTelegramIds.filter((id) => id !== telegramId)
      : [...new Set([...selectedTelegramIds, telegramId])]);
    setManualIdError('');
    setManualUsernameError('');
  };
  const togglePage = () => {
    const visibleIds = new Set(pageIds);
    const nextIds = pageFullySelected
      ? selectedTelegramIds.filter((id) => !visibleIds.has(id))
      : [...new Set([...selectedTelegramIds, ...pageIds])];
    if (nextIds.length > MAX_ELIGIBLE_RECIPIENTS) {
      setManualIdError(t('maxEligibleRecipients', MAX_ELIGIBLE_RECIPIENTS));
      return;
    }
    onSelectionChange(nextIds);
    setManualIdError('');
    setManualUsernameError('');
  };
  const addManualIds = () => {
    const rawIds = manualIdInput.split(/[\s,;]+/).filter(Boolean);
    if (rawIds.length === 0) {
      setManualIdError(t('enterTelegramIds'));
      return;
    }
    if (rawIds.some((id) => !isValidTelegramId(id))) {
      setManualIdError(t('invalidTelegramIds'));
      return;
    }
    const newIds = [...new Set(rawIds.map((id) => BigInt(id).toString()))];
    const nextIds = [...new Set([...selectedTelegramIds, ...newIds])];
    if (nextIds.length > MAX_ELIGIBLE_RECIPIENTS) {
      setManualIdError(t('maxEligibleRecipients', MAX_ELIGIBLE_RECIPIENTS));
      return;
    }
    onSelectionChange(nextIds);
    setManuallyAddedIds((current) => [...new Set([...current, ...newIds])]);
    setManualIdInput('');
    setManualIdError('');
    setManualUsernameError('');
  };
  const addManualUsernames = async () => {
    const rawUsernames = manualUsernameInput.split(/[\s,;]+/).filter(Boolean).map(normalizeUsername);
    if (rawUsernames.length === 0) {
      setManualUsernameError(t('enterTelegramUsernames'));
      return;
    }
    if (rawUsernames.some((username) => !isValidTelegramUsername(username))) {
      setManualUsernameError(t('invalidTelegramUsernames'));
      return;
    }
    const usernames = [...new Set(rawUsernames.map((username) => username.toLowerCase()))];
    if (usernames.length > MAX_ELIGIBLE_RECIPIENTS) {
      setManualUsernameError(t('maxEligibleRecipients', MAX_ELIGIBLE_RECIPIENTS));
      return;
    }
    setResolvingUsernames(true);
    setManualUsernameError('');
    try {
      const result = await adminApi<{ resolved: Array<{ username: string; telegramId: string }> }>(
        `/api/admin/groups/${encodeURIComponent(groupId)}/resolve-usernames`,
        { method: 'POST', body: JSON.stringify({ usernames }) }
      );
      if (!mountedRef.current) return;
      const resolvedIds = [...new Set(result.resolved.map((recipient) => recipient.telegramId))];
      const nextIds = [...new Set([...selectedIdsRef.current, ...resolvedIds])];
      if (nextIds.length > MAX_ELIGIBLE_RECIPIENTS) {
        setManualUsernameError(t('maxEligibleRecipients', MAX_ELIGIBLE_RECIPIENTS));
        return;
      }
      onSelectionChange(nextIds);
      setManuallyAddedIds((current) => [...new Set([...current, ...resolvedIds])]);
      setManualRecipientLabels((current) => ({
        ...current,
        ...Object.fromEntries(result.resolved.map(({ username, telegramId }) => [telegramId, `@${username}`]))
      }));
      setManualUsernameInput('');
      setManualIdError('');
    } catch (error) {
      if (mountedRef.current) setManualUsernameError(error instanceof Error ? error.message : t('unableToResolveUsernames'));
    } finally {
      if (mountedRef.current) setResolvingUsernames(false);
    }
  };
  const removeManualId = (telegramId: string) => {
    onSelectionChange(selectedTelegramIds.filter((id) => id !== telegramId));
    setManuallyAddedIds((current) => current.filter((id) => id !== telegramId));
    setManualRecipientLabels((current) => {
      const next = { ...current };
      delete next[telegramId];
      return next;
    });
    setManualIdError('');
    setManualUsernameError('');
  };

  return <section className="audience-member-picker">
    <div className="picker-header">
      <div><strong>{t('chooseEligibleMembers')}</strong><p>{t('selectedMemberCount', selectedTelegramIds.length)}</p></div>
      <button type="button" className="refresh-button" onClick={() => void query.refetch()}>{t('refreshRoster')}</button>
    </div>
    <p className="picker-note">{t('eligibleMembersNote')}</p>
    <div className="manual-id-entry">
      <label>
        <span>{t('manualTelegramIds')}</span>
        <textarea
          rows={2}
          value={manualIdInput}
          onChange={(event) => setManualIdInput(event.target.value)}
          placeholder={t('manualTelegramIdsPlaceholder')}
          aria-label={t('manualTelegramIds')}
        />
      </label>
      <div className="manual-id-controls">
        <small>{t('manualTelegramIdsHint')}</small>
        <button type="button" className="table-action" onClick={addManualIds}>{t('addTelegramIds')}</button>
      </div>
      {manualIdError && <p className="manual-id-error">{manualIdError}</p>}
    </div>
    <div className="manual-id-entry">
      <label>
        <span>{t('manualTelegramUsernames')}</span>
        <textarea
          rows={2}
          value={manualUsernameInput}
          onChange={(event) => { setManualUsernameInput(event.target.value); setManualUsernameError(''); }}
          placeholder={t('manualTelegramUsernamesPlaceholder')}
          aria-label={t('manualTelegramUsernames')}
        />
      </label>
      <div className="manual-id-controls">
        <small>{t('manualTelegramUsernamesHint')}</small>
        <button type="button" className="table-action" disabled={resolvingUsernames} onClick={() => void addManualUsernames()}>{resolvingUsernames ? t('resolvingUsernames') : t('addUsernames')}</button>
      </div>
      {manualUsernameError && <p className="manual-id-error">{manualUsernameError}</p>}
    </div>
    {selectedManualIds.length > 0 && <div className="manual-id-chips">
      {selectedManualIds.map((id) => <span className="manual-id-chip" key={id}>
        {manualRecipientLabels[id] && <small>{manualRecipientLabels[id]}</small>}
        <code>{id}</code>
        <button type="button" aria-label={t('removeSelectedTelegramId', id)} onClick={() => removeManualId(id)}>×</button>
      </span>)}
    </div>}
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
