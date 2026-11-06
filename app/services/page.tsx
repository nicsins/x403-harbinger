import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Services",
  description:
    "Harbinger premium services: security audits with authorized penetration testing, business research, rare-item finding, and legal event-ticket acquisition. Clear scope, written proposals, accountable next steps.",
  alternates: { canonical: "https://www.x403-harbinger.com/services" },
  robots: { index: false, follow: false },
};

const SECTIONS = [
  { href: "#security", label: "Security audit" },
  { href: "#research", label: "Business research" },
  { href: "#acquisition", label: "Rare-item finding" },
  { href: "#tickets", label: "Event tickets" },
  { href: "#about", label: "About Nic" },
  { href: "#process", label: "How we work" },
  { href: "#cost", label: "Cost" },
  { href: "#remedies", label: "If something goes wrong" },
];

const MAILTO_HELLO =
  "mailto:hello@nicsins.com?subject=Harbinger%20engagement%20inquiry";
const MAILTO_NIC =
  "mailto:nicsins@gmail.com?subject=Harbinger%20engagement%20inquiry";

export default function ServicesPage() {
  return (
    <main className="main services">
      <p className="pill danger" role="note">
        Preview draft — not published · prices and founder claims marked [CONFIRM] pending Nic sign-off
      </p>

      <section className="rise" aria-labelledby="hero-heading">
        <p className="tape">Premium services</p>
        <h1 id="hero-heading" className="display">
          Make the next move with evidence—not guesswork.
        </h1>
        <p className="muted">
          Protect your business. Know who you are dealing with. Find what matters
          without losing days to the search.
        </p>
        <p className="muted">
          Harbinger turns a specific problem into a clear plan, documented
          findings, and an accountable next step. One engagement lead. A written
          scope. No surprise purchases or open-ended work.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <a className="btn primary" href={MAILTO_HELLO}>
            Tell Nic what you need →
          </a>
          <a className="btn ghost" href={MAILTO_NIC}>
            Prefer a direct email?
          </a>
        </div>
        <p className="mono" style={{ marginTop: 12 }}>
          hello@nicsins.com · nicsins@gmail.com
        </p>
        <p className="muted" style={{ marginTop: 12, fontSize: 14 }}>
          Send the business problem, the outcome you need, your deadline, and
          your spending ceiling. Please do not email passwords, payment-card
          details, identity documents, or sensitive case files. We establish an
          appropriate secure handoff if the engagement is accepted.
        </p>
      </section>

      <nav className="panel rise rise-2" aria-label="Service sections">
        <p className="tape">On this page</p>
        <ul className="list services-toc">
          {SECTIONS.map((s) => (
            <li key={s.href}>
              <a href={s.href}>{s.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <section id="security" className="panel rise rise-3" aria-labelledby="security-heading">
        <p className="tape">Security</p>
        <h2 id="security-heading" className="display">
          Know what needs fixing before it becomes an incident
        </h2>
        <h3>Security audit with an authorized penetration test</h3>
        <p>
          Get an evidence-backed view of the weaknesses that matter to your
          business—not a scanner dump and a vague warning.
        </p>
        <p>
          For an agreed web application or external business system, the
          engagement can include exposure and configuration review, hands-on
          penetration testing within written rules of engagement, a
          business-impact summary, reproducible technical findings, and a
          prioritized remediation plan. A report walkthrough and one
          verification of the originally reported fixes within 30 days of
          delivery are included in the agreed scope.
        </p>
        <p>
          <strong>What you receive:</strong> a scoped assessment, executive
          summary, technical evidence, ranked fixes, and a clear record of what
          was and was not tested.
        </p>
        <p>
          <strong>Who does what:</strong> Nic leads the engagement and
          business-risk briefing. A named, qualified security practitioner
          performs and signs off the technical test.{" "}
          <span className="confirm">[CONFIRM]</span> We confirm that
          practitioner, their relevant experience, and any delivery partner
          before you commit. We do not accept a test until the technical
          delivery role is filled.
        </p>
        <p>
          <strong>Boundaries:</strong> written authorization from the system
          owner, approved targets and accounts, test windows, backups and
          rollback readiness, emergency contacts, stop conditions, and any
          necessary hosting/vendor permission come first. Your MSP or IT team
          implements fixes unless separately contracted. Third-party SaaS,
          payment processors, and shared tenant infrastructure are excluded
          unless their owners expressly authorize the test. No denial-of-service,
          destructive testing, phishing, persistence, or access to unrelated
          customer data by default. No claim of certification, guaranteed
          security, insurer acceptance, or regulatory compliance.
        </p>
      </section>

      <section id="research" className="panel" aria-labelledby="research-heading">
        <p className="tape">Research</p>
        <h2 id="research-heading" className="display">
          Check the facts before you commit
        </h2>
        <h3>Business research and background-check coordination</h3>
        <p>
          Know what is documented, what is uncertain, and what deserves another
          question before you hire a vendor, choose a business partner, or commit
          resources.
        </p>
        <p>
          A focused business-research engagement reviews agreed public business
          records and reputable sources. The report separates verified facts from
          allegations and interpretation, links its sources, flags identity
          ambiguities and unavailable records, and ends with practical questions
          for your decision-makers.
        </p>
        <p>
          <strong>What you receive:</strong> a decision brief, source register,
          entity/ownership information where lawfully available, relevant
          publicly documented history within scope, unresolved questions, and one
          factual correction round.
        </p>
        <p>
          <strong>Who does what:</strong> Harbinger coordinates the question,
          research scope, and report. Personal background checks, licensed
          investigative work, restricted-record access, or regulated screening
          are performed only by an appropriately licensed and authorized provider
          under a separately disclosed scope.{" "}
          <span className="confirm">[CONFIRM]</span> If that provider is not
          confirmed, that work is not offered or accepted. Public availability
          alone does not remove licensing requirements; we check jurisdiction and
          purpose before accepting research.
        </p>
        <p>
          <strong>Boundaries:</strong> no stalking, doxxing, account intrusion,
          pretexting for private records, confidential-data purchasing, or
          unsupported accusations. This desk-research offer is not a consumer
          report and must not be used for employment, housing/tenant, credit,
          insurance eligibility, or another FCRA-regulated decision. Such
          screening requires a qualified compliant provider, permissible purpose,
          notices and consent where required, and applicable dispute/adverse-action
          procedures. No legal advice, forensic opinion, surveillance, or
          guarantee that an issue does not exist. Real-estate brokerage and
          licensed transaction work go through licensed professionals.
        </p>
      </section>

      <section id="acquisition" className="panel" aria-labelledby="acquisition-heading">
        <p className="tape">Acquisition</p>
        <h2 id="acquisition-heading" className="display">
          Stop searching. Start choosing.
        </h2>
        <h3>Rare-item finding and acquisition</h3>
        <p>
          Give us the exact item, acceptable condition, authenticity
          requirements, and an all-in ceiling. We identify credible options,
          compare the real delivered cost, and show the trade-offs before you
          decide.
        </p>
        <p>
          <strong>What you receive:</strong> a documented shortlist—or a clear
          no-match report—covering available seller information, condition
          disclosures, return terms, authenticity evidence or
          specialist-authentication options, shipping, taxes/duties estimates,
          and the proposed total cost.
        </p>
        <p>
          <strong>Who does what:</strong> Harbinger researches and coordinates.
          You approve the exact item, seller, total and purchase authority in
          writing; the seller supplies the goods. Independent authentication,
          escrow and insured shipping are used when agreed and available. No
          purchase without your authorization and cleared funds; no Harbinger
          advance of purchase money.
        </p>
        <p>
          <strong>Boundaries:</strong> no prohibited or stolen goods, sanctions
          evasion, counterfeit purchases, misleading provenance claims, or
          unlicensed regulated dealing. No guaranteed availability, authenticity,
          resale value, or delivery date. Authentication limits and residual
          risks are disclosed before purchase. We never substitute an item or
          exceed your all-in cap without fresh approval.
        </p>
      </section>

      <section id="tickets" className="panel" aria-labelledby="tickets-heading">
        <p className="tape">Events</p>
        <h2 id="tickets-heading" className="display">
          Get to the event—without shortcuts that put the tickets at risk
        </h2>
        <h3>Legal event-ticket acquisition</h3>
        <p>
          Tell us the event, seats, quantity, acceptable alternatives, and
          all-in ceiling. We compare authorized primary sellers and lawful resale
          options, disclose fees and transfer restrictions, and act only on your
          approved purchase instruction.
        </p>
        <p>
          <strong>What you receive:</strong> a purchasing plan, the approved
          final total, seller receipt, and delivery/transfer instructions if
          tickets are secured; otherwise, a no-purchase outcome report.
        </p>
        <p>
          <strong>Who does what:</strong> one assigned purchasing agent handles
          each request. You approve the seller, seats, quantity, total and
          purchasing authority. The issuer or seller controls inventory,
          transferability, entry conditions and event performance.
        </p>
        <p>
          <strong>Boundaries:</strong> no bots or automation that violates law or
          platform terms, CAPTCHA or queue bypass, fake identities, purchase-limit
          evasion, account farms, or duplicate buying agents. We comply with
          applicable ticket laws and seller rules. No guaranteed allocation,
          queue position, face-value price, admission, or refund if the event is
          changed or cancelled. No payment is taken for inventory represented as
          secured until it actually is.
        </p>
      </section>

      <section id="about" className="panel" aria-labelledby="about-heading">
        <p className="tape">
          Founder <span className="confirm">[CONFIRM]</span>
        </p>
        <h2 id="about-heading" className="display">
          Led by an operator who understands real-world consequences
        </h2>
        <p>
          Nic&apos;s background combines Army military-intelligence and airborne
          service with the 525th, SERE training, and hands-on commercial
          execution: operating an REO renovation business handling approximately
          $1 million in assets per month, hotel rehabilitation project management
          involving Holiday Inn, La Quinta and Best Western properties, and
          festival/event work with municipalities.{" "}
          <span className="confirm">[CONFIRM — Nic factual sign-off required]</span>
        </p>
        <p>
          That experience shapes how Harbinger works: clear objectives, verified
          information, explicit handoffs and respect for the operating
          environment. Military service and prior project experience do not imply
          government or hotel-brand endorsement, cybersecurity certification,
          investigative licensure, or a current relationship with those
          organizations.
        </p>
      </section>

      <section id="process" className="panel" aria-labelledby="process-heading">
        <p className="tape">Process</p>
        <h2 id="process-heading" className="display">
          Clear scope. Clear ownership.
        </h2>
        <ol className="list services-steps">
          <li>
            <strong>Define the outcome.</strong> We confirm the decision or
            result you need and whether the work is lawful and deliverable.
          </li>
          <li>
            <strong>Agree before work starts.</strong> Your written proposal
            names the lead and any specialist, deliverables, exclusions, timing,
            acceptance criteria, total fee, third-party costs, spending cap,
            data-handling plan and cancellation terms.
          </li>
          <li>
            <strong>Work inside the boundaries.</strong> You receive agreed
            progress updates. Material risks, unavailable evidence and scope
            changes are raised—not hidden.
          </li>
          <li>
            <strong>Deliver and close the loop.</strong> You receive the agreed
            evidence and next steps. Acceptance and any correction or retest are
            handled against the written scope.
          </li>
        </ol>
        <p>
          Tools, including AI, may assist research and drafting; a responsible
          human reviews the final deliverable. Sensitive client information is
          not sent to external AI services without explicit authorization and
          suitable safeguards. Any delivery partner&apos;s role and access are
          disclosed before information is shared.
        </p>
      </section>

      <section id="cost" className="panel" aria-labelledby="cost-heading">
        <p className="tape">
          Cost <span className="confirm">[CONFIRM — proposed anchors]</span>
        </p>
        <h2 id="cost-heading" className="display">
          Cost
        </h2>
        <p>
          Premium, fixed-scope work. The final proposal sets one agreed fee for
          the stated deliverables; there are no automatic add-ons, hidden seller
          markups, or promotional discounts. Larger, more complex or urgent work
          is quoted higher before acceptance. All amounts below are USD.
        </p>
        <div className="cost-table-wrap" role="region" aria-label="Engagement fees">
          <table className="cost-table">
            <caption className="sr-only">
              Proposed professional fees by engagement type
            </caption>
            <thead>
              <tr>
                <th scope="col">Engagement</th>
                <th scope="col">Proposed fee and included scope</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Security audit with penetration test</th>
                <td>
                  <strong>From $5,000</strong>{" "}
                  <span className="confirm">[CONFIRM]</span> for one explicitly
                  scoped small web application or external target set. Includes
                  the agreed manual test, report, walkthrough, and one scoped
                  retest within 30 days. Final fee depends on assets,
                  accounts/roles, test depth and approved specialist delivery.
                </td>
              </tr>
              <tr>
                <th scope="row">Focused business decision brief</th>
                <td>
                  <strong>$1,500</strong>{" "}
                  <span className="confirm">[CONFIRM]</span> for one business
                  entity, one jurisdiction and one defined decision question, up
                  to 10 analyst hours including reporting. Extra entities,
                  restricted records or wider scope require a separately accepted
                  quote; no automatic hourly overrun.
                </td>
              </tr>
              <tr>
                <th scope="row">Extended business due diligence</th>
                <td>
                  <strong>From $3,500</strong>{" "}
                  <span className="confirm">[CONFIRM]</span> for a separately
                  defined multi-source or multi-entity brief. Regulated personal
                  screening/investigations are separately quoted only after
                  licensed-provider and compliance confirmation.
                </td>
              </tr>
              <tr>
                <th scope="row">Rare-item search and acquisition</th>
                <td>
                  <strong>$750 search retainer</strong>{" "}
                  <span className="confirm">[CONFIRM]</span>, credited against a
                  total professional fee of{" "}
                  <strong>
                    the greater of $750 or 25% of the item purchase price before
                    taxes and shipping
                  </strong>
                  . Example: a $4,000 item produces a $1,000 total professional
                  fee, of which $750 has already been paid. If no purchase
                  occurs, the completed search fee is $750; purchase funds are
                  not charged.
                </td>
              </tr>
              <tr>
                <th scope="row">Event-ticket acquisition</th>
                <td>
                  <strong>$350 engagement retainer</strong>{" "}
                  <span className="confirm">[CONFIRM]</span>, credited against a
                  total professional fee of{" "}
                  <strong>
                    the greater of $350 or 20% of the seller&apos;s ticket
                    subtotal before separately itemized seller fees and taxes
                  </strong>
                  . Example: a $2,000 ticket subtotal produces a $400 total
                  professional fee, of which $350 has already been paid. The
                  retainer covers the agreed search/attempt even if no tickets
                  are obtained.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Goods, tickets, seller fees, taxes, shipping, duties, specialist
          authentication, and paid-record charges are separate disclosed
          costs—not included in professional fees. We itemize the total and
          obtain your approval before any third-party spend. The spending
          ceiling includes both our fee and all expected third-party costs.
          There is no second commission on top of the fee formula. These
          services are scoped and invoiced separately from Harbinger&apos;s
          existing automated API products; no existing wallet or API payment
          instruction is changed.
        </p>
      </section>

      <section id="remedies" className="panel" aria-labelledby="remedies-heading">
        <p className="tape">Remedies</p>
        <h2 id="remedies-heading" className="display">
          If something goes wrong
        </h2>
        <p>
          <strong>A material security finding or unsafe test:</strong> testing
          pauses at the agreed threshold; the named client contact is notified
          promptly through the agreed secure channel. Evidence is minimized and
          preserved. Work resumes only under the authorized plan. We do not
          silently exploit further or make unapproved production fixes.
        </p>
        <p>
          <strong>An error in the research or deliverable:</strong> tell Nic
          which fact or agreed requirement is disputed. We review the source
          trail, correct verified errors, and provide the correction to you.
          Missing records and unresolved identities are labeled rather than
          treated as clearance.
        </p>
        <p>
          <strong>
            An unavailable item, failed ticket purchase, or changed seller terms:
          </strong>{" "}
          no substitution and no cap increase without approval. We explain the
          outcome and reconcile approved funds. Completed search work remains
          payable as described in the signed proposal; unearned service fees and
          unspent purchase funds are returned subject to applicable law. Seller
          refunds, cancellation, transfer and return rights are disclosed before
          purchase and remain subject to the seller&apos;s lawful terms; we
          assist with documentation and escalation but cannot promise recovery
          from a third party.
        </p>
        <p>
          <strong>A delivery issue or engagement cancellation:</strong> contact
          Nic at{" "}
          <a href={MAILTO_HELLO}>hello@nicsins.com</a> or{" "}
          <a href={MAILTO_NIC}>nicsins@gmail.com</a>. If we cannot complete the
          agreed service, we explain the issue, propose a remedy, and reconcile
          earned versus unearned fees and authorized commitments in writing.
          Statutory rights are not waived. Liability, insurance, dispute terms,
          confidentiality, retention/deletion, and cancellation details belong in
          the signed agreement, reviewed for the relevant jurisdiction—not in a
          blanket promise on a landing page.
        </p>
      </section>

      <section className="panel want" aria-labelledby="cta-heading">
        <p className="tape">Next step</p>
        <h2 id="cta-heading" className="display">
          Bring us the problem. Leave with a next move.
        </h2>
        <div className="row" style={{ marginTop: 12 }}>
          <a className="btn primary" href={MAILTO_HELLO}>
            Email hello@nicsins.com
          </a>
          <a className="btn ghost" href={MAILTO_NIC}>
            Or nicsins@gmail.com
          </a>
        </div>
        <p className="muted" style={{ marginTop: 16 }}>
          Tell us what a successful outcome looks like. We will tell you whether
          Harbinger is the right fit before you commit.
        </p>
        <p className="mono" style={{ marginTop: 12 }}>
          Looking for the agent notification protocol?{" "}
          <Link href="/">Back to the tape →</Link>
        </p>
      </section>
    </main>
  );
}
