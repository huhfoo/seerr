import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import { SmallLoadingSpinner } from '@app/components/Common/LoadingSpinner';
import Tooltip from '@app/components/Common/Tooltip';
import ReleaseScore from '@app/components/ReleaseSearch/ReleaseScore';
import defineMessages from '@app/utils/defineMessages';
import { formatBytes } from '@app/utils/numberHelpers';
import { Radio, RadioGroup } from '@headlessui/react';
import { ArrowPathIcon, CheckCircleIcon } from '@heroicons/react/24/solid';
import type { ReleaseResult } from '@server/interfaces/api/releaseInterfaces';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.ReleaseSearch.Results', {
  releases: 'Releases',
  search: 'Filter releases',
  refresh: 'Refresh releases',
  loading: 'Searching indexers…',
  empty: 'No releases found.',
  noMatches: 'No releases match your filter.',
  error:
    'Unable to search releases. Check the connection to Sonarr/Radarr and try again.',
  rejected: 'Rejected',
  more: 'Show more',
  seeds: '{count, number} seeders',
});

const ReleaseResults = ({
  url,
  selected,
  onSelect,
  disabled = false,
}: {
  url: string;
  selected?: ReleaseResult | null;
  onSelect: (release: ReleaseResult) => void;
  disabled?: boolean;
}) => {
  const intl = useIntl();
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(30);
  const { data, error, isLoading, isValidating, mutate } = useSWR<
    ReleaseResult[]
  >(
    url,
    (path: string) =>
      axios
        .get<ReleaseResult[]>(path, { timeout: 180000 })
        .then((response) => response.data),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    }
  );
  const releases = data?.filter((release) =>
    [
      release.title,
      release.releaseGroup,
      release.indexer,
      release.quality?.quality?.name,
    ].some((text) => text?.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <section
      className="mt-4 border-t border-gray-700 pt-4"
      aria-label={intl.formatMessage(messages.releases)}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          {intl.formatMessage(messages.releases)}
          {data && <Badge badgeType="light">{data.length}</Badge>}
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-gray-400 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          onClick={() => mutate()}
          disabled={disabled || isValidating}
          aria-label={intl.formatMessage(messages.refresh)}
        >
          <ArrowPathIcon
            className={`h-4 w-4 ${isValidating ? 'animate-spin' : ''}`}
          />
        </button>
      </div>
      {isLoading && (
        <div
          className="space-y-3 py-6 text-center text-sm text-gray-400"
          role="status"
        >
          <SmallLoadingSpinner />
          <p>{intl.formatMessage(messages.loading)}</p>
        </div>
      )}
      {error && (
        <Alert type="error" title={intl.formatMessage(messages.error)} />
      )}
      {data && data.length > 0 && (
        <>
          <input
            type="search"
            disabled={disabled}
            className="mb-3 w-full rounded-md border border-gray-700 bg-gray-800 text-sm text-white placeholder-gray-400 focus:border-indigo-500 focus:ring-indigo-500"
            placeholder={intl.formatMessage(messages.search)}
            aria-label={intl.formatMessage(messages.search)}
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setLimit(30);
            }}
          />
          <RadioGroup
            value={selected ?? null}
            disabled={disabled}
            by={(a, b) => a?.guid === b?.guid && a?.indexerId === b?.indexerId}
            onChange={(release) => {
              if (release) onSelect(release);
            }}
            aria-label={intl.formatMessage(messages.releases)}
            className="max-h-80 divide-y divide-gray-700 overflow-auto rounded-md border border-gray-700"
          >
            {releases?.slice(0, limit).map((release) => (
              <Radio
                as="button"
                type="button"
                value={release}
                key={`${release.indexerId}-${release.guid}`}
                className={({ checked }) =>
                  `flex w-full items-start gap-3 px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 ${checked ? 'bg-indigo-500/10' : 'bg-gray-800/50 hover:bg-gray-700/60'}`
                }
              >
                {({ checked }) => (
                  <>
                    <span className="mt-0.5 flex-shrink-0">
                      {checked ? (
                        <CheckCircleIcon className="h-5 w-5 text-indigo-400" />
                      ) : (
                        <span className="block h-5 w-5 rounded-full border border-gray-500" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-normal">
                      <span className="block whitespace-normal break-all text-sm font-medium leading-5 text-gray-100">
                        {release.title}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
                        {release.quality?.quality?.name && (
                          <Badge badgeType="light">
                            {release.quality.quality.name}
                          </Badge>
                        )}
                        <ReleaseScore release={release} />
                        {release.releaseGroup && (
                          <span className="font-medium text-gray-300">
                            {release.releaseGroup}
                          </span>
                        )}
                        <span>{release.indexer}</span>
                        <span className="uppercase">{release.protocol}</span>
                        {release.seeders !== undefined && (
                          <span>
                            {intl.formatMessage(messages.seeds, {
                              count: release.seeders,
                            })}
                          </span>
                        )}
                        {release.rejected && (
                          <Tooltip
                            content={
                              release.rejections?.join('; ') ||
                              intl.formatMessage(messages.rejected)
                            }
                          >
                            <span>
                              <Badge badgeType="danger">
                                {intl.formatMessage(messages.rejected)}
                              </Badge>
                            </span>
                          </Tooltip>
                        )}
                      </span>
                    </span>
                    <span className="mt-0.5 whitespace-nowrap text-xs text-gray-300">
                      {formatBytes(release.size)}
                    </span>
                  </>
                )}
              </Radio>
            ))}
          </RadioGroup>
          {releases?.length === 0 && (
            <p className="py-4 text-sm text-gray-400">
              {intl.formatMessage(messages.noMatches)}
            </p>
          )}
          {!!releases && releases.length > limit && (
            <div className="mt-3 text-center">
              <Button
                buttonType="ghost"
                buttonSize="sm"
                disabled={disabled}
                onClick={() => setLimit(limit + 30)}
              >
                {intl.formatMessage(messages.more)}
              </Button>
            </div>
          )}
        </>
      )}
      {data?.length === 0 && (
        <p className="py-4 text-sm text-gray-400">
          {intl.formatMessage(messages.empty)}
        </p>
      )}
    </section>
  );
};
export default ReleaseResults;
