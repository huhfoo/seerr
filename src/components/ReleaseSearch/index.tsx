import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import ReleaseResults from '@app/components/ReleaseSearch/ReleaseResults';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import type Media from '@server/entity/Media';
import type {
  ReleaseEpisode,
  ReleaseResult,
} from '@server/interfaces/api/releaseInterfaces';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.ReleaseSearch', {
  title: 'Releases',
  title4k: '4K Releases',
  browse: 'Browse releases',
  browse4k: 'Browse 4K releases',
  target: 'Season or episode',
  select: 'Select a season or episode',
  season: 'Season {number}',
  entireseason: 'Entire season',
  episode: 'Episode {number} · {title}',
  search: 'Search releases',
  download: 'Download',
  sent: 'Sent to download client: {title}',
  episodeerror:
    'Unable to load episodes. Wait for the title to be linked to Sonarr and reopen this window.',
});

type Props = {
  mediaId: number;
  mediaType: 'tv' | 'movie';
  is4k: boolean;
  onClose: () => void;
};

const ReleaseSearch = ({ mediaId, mediaType, is4k, onClose }: Props) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [target, setTarget] = useState('');
  const [searchUrl, setSearchUrl] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReleaseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: episodes, error } = useSWR<ReleaseEpisode[]>(
    mediaType === 'tv' ? `/api/v1/media/${mediaId}/episodes?is4k=${is4k}` : null
  );
  const url = `/api/v1/media/${mediaId}/releases?is4k=${is4k}${target ? `&${target}` : ''}`;
  const grab = async () => {
    if (!selected || !searchUrl) return;
    setBusy(true);
    try {
      await axios.post(searchUrl, {
        guid: selected.guid,
        indexerId: selected.indexerId,
      });
      addToast(intl.formatMessage(messages.sent, { title: selected.title }), {
        appearance: 'success',
        autoDismiss: true,
      });
      setSelected(null);
    } catch (error) {
      addToast(
        axios.isAxiosError(error)
          ? (error.response?.data?.message ??
              intl.formatMessage(globalMessages.error))
          : intl.formatMessage(globalMessages.error),
        { appearance: 'error', autoDismiss: true }
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={intl.formatMessage(is4k ? messages.title4k : messages.title)}
      onCancel={onClose}
      cancelText={intl.formatMessage(globalMessages.close)}
      onOk={grab}
      okText={intl.formatMessage(messages.download)}
      okDisabled={busy || !selected || selected.rejected}
      backgroundClickable={!busy}
    >
      {mediaType === 'tv' && (
        <div className="mb-4">
          <label htmlFor="release-target">
            {intl.formatMessage(messages.target)}
          </label>
          <select
            id="release-target"
            disabled={busy}
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
              setSearchUrl(null);
              setSelected(null);
            }}
          >
            <option value="">{intl.formatMessage(messages.select)}</option>
            {[...new Set(episodes?.map((episode) => episode.seasonNumber))]
              .sort((a, b) => a - b)
              .map((season) => (
                <optgroup
                  key={season}
                  label={intl.formatMessage(messages.season, {
                    number: season,
                  })}
                >
                  <option value={`seasonNumber=${season}`}>
                    {intl.formatMessage(messages.entireseason)}
                  </option>
                  {episodes
                    ?.filter((episode) => episode.seasonNumber === season)
                    .map((episode) => (
                      <option
                        key={episode.id}
                        value={`episodeId=${episode.id}`}
                      >
                        {intl.formatMessage(messages.episode, {
                          number: episode.episodeNumber,
                          title: episode.title,
                        })}
                      </option>
                    ))}
                </optgroup>
              ))}
          </select>
          {error && (
            <Alert
              type="error"
              title={intl.formatMessage(messages.episodeerror)}
            />
          )}
        </div>
      )}
      {!searchUrl && (
        <Button
          buttonType="primary"
          disabled={busy || (mediaType === 'tv' && !target)}
          onClick={() => setSearchUrl(url)}
        >
          {intl.formatMessage(messages.search)}
        </Button>
      )}
      {searchUrl && (
        <ReleaseResults
          key={searchUrl}
          url={searchUrl}
          selected={selected}
          onSelect={setSelected}
          disabled={busy}
        />
      )}
    </Modal>
  );
};

export const ReleaseSearchControls = ({
  media,
  mediaType,
  onClose,
}: {
  media?: Pick<Media, 'id' | 'externalServiceId' | 'externalServiceId4k'>;
  mediaType: Props['mediaType'];
  onClose: () => void;
}) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const [is4k, setIs4k] = useState<boolean | null>(null);
  if (!media || !hasPermission(Permission.MANAGE_REQUESTS)) return null;
  return (
    <div className="flex gap-2">
      {[false, true].map((quality) =>
        media[quality ? 'externalServiceId4k' : 'externalServiceId'] ? (
          <Button key={String(quality)} onClick={() => setIs4k(quality)}>
            {intl.formatMessage(quality ? messages.browse4k : messages.browse)}
          </Button>
        ) : null
      )}
      {is4k !== null && (
        <ReleaseSearch
          key={String(is4k)}
          mediaId={media.id}
          mediaType={mediaType}
          is4k={is4k}
          onClose={() => {
            setIs4k(null);
            onClose();
          }}
        />
      )}
    </div>
  );
};
export default ReleaseSearch;
