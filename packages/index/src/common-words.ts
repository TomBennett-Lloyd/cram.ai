/** Carriers: `.claude/ledgers/common-word-count.ledger`. */
export const COMMON_WORD_COUNT = 601;

/** Everyday English `correctSpelling` never rewrites into a course term (#393); self-authored, no third-party licence. */
export const COMMON_WORDS: readonly string[] = `
a about above across after again against ago all almost along already also although always am
among an and another any anyone anything are around as at away be because been before behind being
below beneath beside besides between beyond both but by can cannot could did do does doing done
down during each either else enough even ever every everyone everything except few for from
further had has have having he her here hers herself him himself his how however i if in inside
instead into is it its itself just least less like many may me might mine more most much must my
myself near neither never no nobody none nor not nothing now of off often on once only onto or
other others otherwise our ours ourselves out outside over own per perhaps quite rather same
several shall she should since so some somebody someone something sometimes somewhere soon still
such than that the their theirs them themselves then there therefore these they this those though
through throughout thus to together too toward towards under unless until up upon us usually very
via was we well were what whatever when whenever where whereas wherever whether which while who
whoever whole whom whose why will with within without would yet you your yours yourself yourselves
ask answer apply argue become begin believe break bring buy call carry cause change choose come
compare consider contain continue count cover create cut decide define depend describe determine
develop differ discuss draw drive eat end explain fall feel fill find finish follow forget get
give go grow happen hear help hold include increase keep kill know lead learn leave let lie list
live look lose make mean measure meet move name need note occur open pay play point prefer prepare
prevent produce provide put reach read reduce relate remain remember remove repeat require rest
return run say see seem sell send serve set show sit sleep speak stand start state stay step stop
study suggest support suppose take talk teach tell tend test think throw treat try turn understand
use wait walk want watch wear win wish work write age air amount animal area arm back bit body
book box case century child city class colour color country course day deal detail difference door
example eye face fact family field figure form friend front game group half hand head heart home
hour house idea issue kind level life light line lot man matter meaning member mind minute moment
money month morning mother night number order page paper part people period person picture place
plan problem process question reason result room rule school section sense side size sort sound
space stage story student subject system table term thing time top topic type value view water way
week weight woman word world year definition function mechanism purpose role effect relationship
versus vs able actual bad basic big black blue certain clear close cold common complete correct
dark dead deep different difficult early easy entire equal exact fast final fine first free full
general good great green hard heavy high hot important large last late left little local long low
main major minor modern natural new next nice normal old particular past poor possible present
pretty quick ready real recent red right round short similar simple single slow small soft special
strong sure true usual warm white wide wrong yellow young actually especially exactly finally
generally likely mostly nearly probably really simply truly twice zero one two three four five six
seven eight nine ten eleven twelve twenty thirty hundred thousand million second third fourth
fifth
`
  .trim()
  .split(/\s+/);
