import Badge from '@app/components/Common/Badge';
import Tooltip from '@app/components/Common/Tooltip';
import defineMessages from '@app/utils/defineMessages';
import type { ReleaseResult } from '@server/interfaces/api/releaseInterfaces';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.ReleaseSearch.Score', {
  score: 'Score {score}',
  description: 'Custom format score from Sonarr/Radarr',
  formats: 'Matched custom formats: {formats}',
  unavailable: 'Custom format score is not available for this release.',
});

const ReleaseScore = ({ release }: { release: ReleaseResult }) => {
  const intl = useIntl();
  const score = release.customFormatScore;
  const available = typeof score === 'number' && Number.isFinite(score);
  const formats = release.customFormats
    ?.map((format) => format.name)
    .filter(Boolean);
  const description = available
    ? [
        intl.formatMessage(messages.description),
        formats?.length
          ? intl.formatMessage(messages.formats, {
              formats: formats.join(', '),
            })
          : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : intl.formatMessage(messages.unavailable);
  return (
    <Tooltip content={description}>
      <span aria-label={description}>
        <Badge
          badgeType={
            !available || score === 0
              ? 'light'
              : score > 0
                ? 'success'
                : 'danger'
          }
        >
          {intl.formatMessage(messages.score, {
            score: available
              ? intl.formatNumber(score, {
                  signDisplay: score > 0 ? 'always' : 'auto',
                })
              : '—',
          })}
        </Badge>
      </span>
    </Tooltip>
  );
};
export default ReleaseScore;
