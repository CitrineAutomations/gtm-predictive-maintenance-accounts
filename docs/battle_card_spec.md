# Battle card spec

A battle card is a one-page brief that an SDR reads before contacting one parent company. It answers what we know about the account, who to reach, what to send and what not to say.

Make one card for each account. Write for a reader who has two minutes and has never heard of the company.

## Rules for every fact

- Give each fact a source and a date.
- Write "Unknown" when we don't know, and say where to check. Never guess.
- Say what the record does not show. A violation or citation is not proof of an equipment failure.
- Mark data from a third-party copy, and tell the SDR to check the official record before calling.
- Say when we have not read a document that a record points to.
- Put no names, emails or phone numbers of people in a card stored in this repository. Use job roles.

## Layout

Sections appear in this order.

| # | Section | Width |
| --- | --- | --- |
| 1 | Header, quick read and account facts | Full |
| 2 | Angle note and angle tabs | Full |
| 3 | Angle panel: the record, first email | Two columns |
| 4 | Call background | Full |
| 5 | Who to reach, questions to ask | Two columns |
| 6 | Objections, then "Do not" with goal and logging | Two columns |

Columns stack into one on a phone.

## Content

### 1. Header, quick read and account facts

Start with the line "Draft battle card · SDR use · check every fact before you call", then the parent company name.

Under the name, show when the facts were last checked, who owns the card, its version and its status (Draft, In use or Retired).

Then give a quick read of up to four bullets that fit on one screen:

- the start plant
- who to contact first
- the one question to ask
- the biggest thing not to say

Show these six facts as a grid:

| Fact | What to put |
| --- | --- |
| Owner | The company that owns the parent, if any |
| Industry | Plain name, not a NAICS code |
| Plants we see | Plant count and state count |
| EPA signal | Number of plants with 4 or more non-compliance quarters out of the last 12 |
| OSHA signal | Number of plants with a serious, repeat or willful citation since 2023-11-01 |
| Customer today | Yes with the plant, No, or "Unknown. Check Salesforce." |

Under the grid, list the plant count by state, the source and its year. Note that the company may have plants the source does not list. EPA TRI only covers plants that report toxic releases.

### 2. Angle note and tabs

An angle is the reason given for making contact. There are three: OSHA, EPA and Control (no signal).

Each account gets one angle in the 60-day test. State this above the tabs and tell the SDR to use only the assigned angle. Show only the tabs the account has data for. Control is always available.

### 3. Angle panel

The left box is the record. Name one start plant, with city and state, then list:

- what happened, with dates
- the rule or program involved, with a link
- penalty amounts, if listed
- the source and its limits

After the facts, say in one line why they matter and what the SDR should do with them.

If the record could mislead, add a warning box that says what not to claim. List other flagged plants in one line.

For Control, the left box says to pick any plant on the account and explains that this group measures the reply rate without a signal.

The right box is the first email.

| Part | Rule |
| --- | --- |
| Subject | Same across all three angles: "machines and calendars" |
| First line | Same across all three: "Machines do not read the maintenance calendar, [first name]." |
| Middle | One or two sentences. This is the only part that changes by angle. |
| Last line | "Which equipment at [plant] worries you most between inspections? Worth 20 minutes?" |

The shared lines keep the test fair, because the middle is the only difference. The email never names a violation, citation or penalty. Say so under the email.

### 4. Call background

Summarize the public record for the EPA start plant, program by program (air, water, hazardous waste), with inspection dates, notices, orders and quarters in non-compliance. Give the date the data was pulled.

End with "What it means for you" in one or two sentences, including whether the SDR should raise it at all.

Leave this section out if there is no record worth reading before a call.

### 5. Who to reach and questions to ask

Show two contact orders.

New account:

1. Plant manager at the start plant.
2. Maintenance or reliability manager at the same plant.
3. IT and procurement, after the plant team shows interest.

Existing customer:

1. Tell the account owner first. Do not cold email.
2. Ask the champion at the live plant for results and an introduction.
3. Contact the plant manager at the next plant.

Say whether we have contact names yet.

Give up to six discovery questions that cover:

- which equipment stops the line most often
- the cost of one hour of unplanned downtime
- how the team finds a failing pump or motor today
- what vibration, temperature or pressure data they collect
- who decides on a new tool (plant, division or head office)
- which plant is next if the first one gets results

### 6. Objections, do not, goal and logging

Answer each objection with a question or a small next step, not a pitch.

| Objection | Response |
| --- | --- |
| "We already do preventive maintenance." | Ask which failures still happen between scheduled checks. |
| "IT will not allow it." | Offer to include the IT lead early. Ask what rules a new data tool must meet. |
| "We have no budget." | Ask what the last unplanned stop cost. Offer a one-plant start. |
| "Head office decides." | Ask who at head office, and whether a one-plant trial needs that approval. |

The "Do not" box always includes:

- Do not open with a violation or a penalty.
- Do not claim the product fixes compliance or safety problems.
- Do not promise savings without real customer proof.
- Do not say the owner buys for this company unless we know it does.

Add account-specific lines below these.

The goal is one meeting with the plant team. The SDR logs the angle used and one result (no reply, reply or meeting booked).

Product proof points must come from the vendor. Until they do, the card says they are missing. Once they arrive, put each one next to the objection it answers, with a link.

If we learn that the account already uses a monitoring or maintenance tool, add its name, the source and one question that finds the gap. Otherwise leave competitors off the card.

## Visual style

| Item | Value |
| --- | --- |
| Headings | Space Grotesk. Section headings are small, uppercase and teal. |
| Body | Inter, 14.5px |
| Accent, light and dark | `#0f6b5c` and `#5fc4ae` |
| Page width | 960px at most |
| Sections | Bordered boxes with 8px corners |
| Email | Tinted box, set apart from the notes around it |
| Warning | Amber box |
| "Do not" list | Red box |

Support light and dark themes. Sources and caveats use smaller, muted text next to the fact they describe.

## Keeping cards current

- Check the facts again before the account enters outreach, and when an SDR reports one is wrong.
- Update the last-checked date and version after each change.
- Do not change the email during the 60-day test. If a fact behind it turns out to be wrong, pause the account and record why.
- Ask the SDRs which parts of the card they used and what was missing.
- Judge the cards by replies and meetings for each angle, not by how often they are opened.

## Sources for the format

The quick read, card status and proof beside each objection draw on [Apollo's battle card template](https://www.apollo.io/insights/sales-battlecard-template). The "why it matters, what to do" line adapts the Fact, Impact, Act structure in [Klue's battlecard guide](https://klue.com/blog/competitive-battlecards-101). Both articles are about competitor cards from vendors that sell related tools, so we left out their competitor sections and statistics.

## Check before handing over a card

- Every number and date matches its source.
- Every link opens.
- Unknown items say "Unknown".
- The first line and last line match across the angles.
- No email names a violation, citation or penalty.
- No claim goes further than the record.
- No personal contact data is in the file.
