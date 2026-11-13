import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import { SmallLoadingSpinner } from '@app/components/Common/LoadingSpinner';
import ReleaseResults from '@app/components/ReleaseSearch/ReleaseResults';
import useSettings from '@app/hooks/useSettings';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type {
  PreparedSeriesResponse,
  ReleaseEpisode,
  ReleaseResult,
} from '@server/interfaces/api/releaseInterfaces';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.TvDetails.Season.EpisodeActions', {
  request: 'Request',
  choose: 'Choose Release',
  hide: 'Hide Releases',
  download: 'Download Selected Release',
  requesting: 'Requesting…',
  available: 'Available',
  requested: 'Requested',
  pending: 'Pending Approval',
  sent: 'Release sent to Sonarr.',
  preparing: 'Preparing release search…',
  prepareError: 'Unable to prepare release search. Please try again.',
  missing:
    'This episode is not available in Sonarr yet. Refresh the series in Sonarr and try again.',
  requestError: 'Unable to submit this request. Please try again.',
  grabError:
    'The request is saved, but the release could not be sent to Sonarr. Select a release and try again.',
  retry: 'Retry',
  quality: 'Request quality',
  standard: 'Standard',
});

type Props = {
  tv: TvDetails;
  seasonNumber: number;
  episodeNumber: number;
};

const EpisodeActions = ({ tv, seasonNumber, episodeNumber }: Props) => {
  const intl = useIntl();
  const settings = useSettings();
  const { user, hasPermission } = useUser();
  const standard = hasPermission([Permission.REQUEST, Permission.REQUEST_TV], {
    type: 'or',
  });
  const fourK =
    settings.currentSettings.series4kEnabled &&
    hasPermission([Permission.REQUEST_4K, Permission.REQUEST_4K_TV], {
      type: 'or',
    });
  const [prefer4k, setPrefer4k] = useState(false);
  const is4k = !!fourK && (!standard || prefer4k);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReleaseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<'pending' | 'requested' | 'sent' | null>(
    null
  );
  const canSearch = hasPermission(Permission.MANAGE_REQUESTS);
  const media = tv.mediaInfo;
  const linked = is4k ? media?.externalServiceId4k : media?.externalServiceId;
  const episodeQuery = `is4k=${is4k}&seasonNumber=${seasonNumber}&episodeNumber=${episodeNumber}`;
  const libraryUrl = `/api/v1/media/${media?.id}/episodes?${episodeQuery}`;
  const { data: libraryEpisodes } = useSWR<ReleaseEpisode[]>(
    canSearch && linked ? libraryUrl : null
  );
  const {
    data: prepared,
    error: prepareError,
    isLoading: preparing,
    mutate: retry,
  } = useSWR<PreparedSeriesResponse>(
    open
      ? [`/api/v1/tv/${tv.id}/prepare`, is4k, seasonNumber, episodeNumber]
      : null,
    ([url, quality]: [string, boolean]) =>
      axios
        .post<PreparedSeriesResponse>(
          url,
          { is4k: quality, seasonNumber, episodeNumber },
          { timeout: 90000 }
        )
        .then((response) => response.data),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    }
  );
  const matches = (ep: { seasonNumber: number; episodeNumber: number }) =>
    ep.seasonNumber === seasonNumber && ep.episodeNumber === episodeNumber;
  const episode = prepared?.episodes.find(matches);
  // A current file lookup takes precedence over historical request/season state.
  const libraryEpisode = libraryEpisodes?.find(matches) ?? episode;
  const available = libraryEpisode
    ? libraryEpisode.hasFile
    : media?.seasons.some(
        (season) =>
          season.seasonNumber === seasonNumber &&
          season[is4k ? 'status4k' : 'status'] === MediaStatus.AVAILABLE
      );
  const request = media?.requests.find(
    (request) =>
      request.is4k === is4k &&
      request.status !== MediaRequestStatus.DECLINED &&
      request.status !== MediaRequestStatus.FAILED &&
      request.status !== MediaRequestStatus.COMPLETED &&
      (request.episodes?.length
        ? request.episodes.some(matches)
        : request.seasons.some(
            (season) => season.seasonNumber === seasonNumber
          ))
  );
  const requested = !!request || !!result;
  const pending =
    request?.status === MediaRequestStatus.PENDING || result === 'pending';
  const submit = async (release?: ReleaseResult) => {
    if (busy || (release && (!prepared || !episode))) return;
    setBusy(true);
    setError(null);
    let requestSaved = false;
    try {
      const response = await axios.post<MediaRequest | { message: string }>(
        '/api/v1/request',
        {
          mediaType: MediaType.TV,
          manualSearch: !!release,
          mediaId: tv.id,
          tvdbId: tv.externalIds.tvdbId,
          is4k,
          serverId: release
            ? (media?.[is4k ? 'serviceId4k' : 'serviceId'] ?? undefined)
            : undefined,
          seasons: [seasonNumber],
          episodes: [{ seasonNumber, episodeNumber }],
        }
      );
      requestSaved = true;
      if (release && prepared && episode) {
        await axios.post(
          `/api/v1/media/${prepared.mediaId}/releases?is4k=${is4k}&episodeId=${episode.id}`,
          { guid: release.guid, indexerId: release.indexerId }
        );
      }
      setResult(
        release
          ? 'sent'
          : 'media' in response.data &&
              response.data.status === MediaRequestStatus.PENDING
            ? 'pending'
            : 'requested'
      );
      setSelected(null);
      if (release) setOpen(false);
    } catch (error) {
      setError(
        requestSaved && release
          ? intl.formatMessage(messages.grabError)
          : axios.isAxiosError(error)
            ? (error.response?.data?.message ??
              intl.formatMessage(messages.requestError))
            : intl.formatMessage(messages.requestError)
      );
    } finally {
      setBusy(false);
      mutate(`/api/v1/tv/${tv.id}`);
      mutate('/api/v1/request/count');
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      if (user) mutate(`/api/v1/user/${user.id}/quota`);
      if (media) mutate(libraryUrl);
    }
  };

  if (
    (!standard && !fourK) ||
    media?.[is4k ? 'status4k' : 'status'] === MediaStatus.BLOCKLISTED
  )
    return null;

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {standard && fourK && (
          <select
            aria-label={intl.formatMessage(messages.quality)}
            value={String(is4k)}
            disabled={busy}
            className="rounded-md border border-gray-600 bg-gray-800 py-1 text-sm text-white"
            onChange={(event) => {
              setPrefer4k(event.target.value === 'true');
              setSelected(null);
              setResult(null);
              setError(null);
            }}
          >
            <option value="false">
              {intl.formatMessage(messages.standard)}
            </option>
            <option value="true">4K</option>
          </select>
        )}
        {!standard && fourK && <Badge badgeType="light">4K</Badge>}
        <Button
          buttonSize="sm"
          buttonType="primary"
          disabled={busy || available || requested}
          onClick={() => submit()}
        >
          {intl.formatMessage(
            busy
              ? messages.requesting
              : available
                ? messages.available
                : requested
                  ? pending
                    ? messages.pending
                    : messages.requested
                  : messages.request
          )}
        </Button>
        {canSearch && (
          <Button
            buttonSize="sm"
            buttonType="ghost"
            disabled={busy}
            aria-expanded={open}
            aria-controls={`episode-releases-${tv.id}-${seasonNumber}-${episodeNumber}`}
            onClick={() => {
              setOpen(!open);
              setSelected(null);
            }}
          >
            {intl.formatMessage(open ? messages.hide : messages.choose)}
          </Button>
        )}
        {result === 'sent' && (
          <span role="status">
            <Badge badgeType="success">
              {intl.formatMessage(messages.sent)}
            </Badge>
          </span>
        )}
      </div>
      {error && <Alert type="error" title={error} />}
      {open && (
        <div
          id={`episode-releases-${tv.id}-${seasonNumber}-${episodeNumber}`}
          className="rounded-md border border-gray-700 bg-gray-900/30 p-3"
        >
          {preparing && (
            <div
              className="flex items-center gap-3 py-4 text-sm text-gray-400"
              role="status"
            >
              <span className="w-5">
                <SmallLoadingSpinner />
              </span>
              {intl.formatMessage(messages.preparing)}
            </div>
          )}
          {prepared && !episode && (
            <Alert
              type="warning"
              title={intl.formatMessage(messages.missing)}
            />
          )}
          {prepareError && (
            <>
              <Alert
                type="error"
                title={intl.formatMessage(messages.prepareError)}
              />
              <Button buttonSize="sm" onClick={() => retry()}>
                {intl.formatMessage(messages.retry)}
              </Button>
            </>
          )}
          {episode && prepared && (
            <>
              <ReleaseResults
                key={`${prepared.mediaId}-${episode.id}-${is4k}`}
                url={`/api/v1/media/${prepared.mediaId}/releases?is4k=${is4k}&episodeId=${episode.id}`}
                selected={selected}
                onSelect={setSelected}
                disabled={busy}
              />
              <Button
                className="mt-3"
                buttonSize="sm"
                buttonType="primary"
                disabled={busy || !selected || selected.rejected}
                onClick={() => selected && submit(selected)}
              >
                {intl.formatMessage(messages.download)}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default EpisodeActions;
