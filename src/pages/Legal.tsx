import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Plain-language policy pages. They are readable before sign-in, because the
 * privacy terms apply to someone who has not created an account yet.
 *
 * Everything here describes what the code actually does: entries are encrypted
 * in this browser, and a verified account protects AI access.
 */

const LAST_UPDATED = '1 November 2026';

const LegalShell: React.FC<{
  title: string;
  summary: string;
  children: React.ReactNode;
}> = ({ title, summary, children }) => (
  <div className="min-h-screen bg-background text-foreground">
    <div className="mx-auto max-w-2xl px-5 py-10 space-y-8">
      <header className="space-y-3 border-b border-border pb-5">
        <Link
          to="/"
          className="text-[10px] font-black uppercase tracking-widest text-primary underline underline-offset-4"
        >
          Back to Serene Structure
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">{summary}</p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Last updated {LAST_UPDATED}
        </p>
      </header>
      <div className="space-y-7">{children}</div>
      <footer className="border-t border-border pt-5 flex flex-wrap gap-x-5 gap-y-2">
        <Link to="/privacy" className="text-[10px] font-bold uppercase tracking-widest text-primary underline underline-offset-4">Privacy</Link>
        <Link to="/terms" className="text-[10px] font-bold uppercase tracking-widest text-primary underline underline-offset-4">Terms</Link>
        <Link to="/cookies" className="text-[10px] font-bold uppercase tracking-widest text-primary underline underline-offset-4">Cookies</Link>
        <Link to="/about" className="text-[10px] font-bold uppercase tracking-widest text-primary underline underline-offset-4">About</Link>
      </footer>
    </div>
  </div>
);

const Section: React.FC<{ heading: string; children: React.ReactNode }> = ({ heading, children }) => (
  <section className="space-y-2">
    <h2 className="text-base font-semibold tracking-tight">{heading}</h2>
    <div className="text-sm leading-relaxed text-muted-foreground space-y-2">{children}</div>
  </section>
);

export const PrivacyPolicy: React.FC = () => (
  <LegalShell
    title="Privacy policy"
    summary="Serene Structure keeps your journal encrypted on the device you use. A verified account protects AI access, but the server never receives your journal, your password or your encryption key."
  >
    <Section heading="Who is responsible for your data">
      <p>
        You are. Your journal runs entirely inside your browser. Supabase Auth holds your account
        identity so AI access cannot be claimed by anonymous browsers; this app's server checks that
        identity and stores your profile, wallet and subscription. Neither this server nor Supabase
        receives your journal or encryption key.
      </p>
    </Section>

    <Section heading="What is stored, and where">
      <p>
        Creating an account saves your display name, email address, a random salt and an encrypted
        check value in this browser's local storage. Supabase Auth stores your account email and a
        password hash; this app's server stores your display name, profile, wallet and subscription.
        Your password itself is never stored. The journal password is stretched with PBKDF2-SHA256
        (600,000 iterations for new accounts) into a 256-bit key that encrypts entries with AES-GCM.
      </p>
      <p>
        Tasks, routines, meals, workouts, sleep, activity, cycle, mood, journal entries, lists,
        budgets, recipes and photos you add are saved as ciphertext under keys that only your
        account can decrypt. The unlocked key is held in session storage so a page reload does not
        ask for your password again; closing the browser or tab clears it.
      </p>
    </Section>

    <Section heading="What leaves the device">
      <p>
        Account registration sends your name, email and password over TLS to this server, which
        forwards the credentials to Supabase Auth. Your encrypted journal and encryption key are
        never sent. Nothing else is uploaded unless you use the AI assistant. The app loads no analytics, advertising,
        error-reporting or tracking code, and it downloads no webfonts or icons from a third party.
        The type, icons and styles are all part of the app itself.
      </p>
      <p>
        The assistant is the one feature that sends anything out. When it is on and you send it a
        message, the server this app runs on forwards that message, the last few replies, the notes you
        asked it to remember and a small snapshot of your app data (open task counts and titles, meals
        logged today, workouts this week, average sleep quality, latest mood, this month's spending) to
        the AI provider chosen by whoever runs the server. Your name, email and password are never
        sent, and neither are journal entries, cycle notes or photos saved elsewhere in the app. A
        photo or file you deliberately attach to a coach message is sent with that message. The
        provider's own privacy terms apply to what it receives. The app itself keeps no copy of these
        requests on the server.
      </p>
      <p>
        Your conversation and anything you ask it to remember are stored in the same encrypted vault as
        the rest of your entries, so they are unreadable without your password. Turning the assistant
        off in Settings keeps everything on this device again, and clearing the conversation in the
        coach deletes it from the vault.
      </p>
      <p>
        What is sent is limited on purpose. Only the sections a question mentions are included, and
        journal entries, cycle notes, photos saved elsewhere in the app and mood notes never are. A file
        you attach to a coach message is sent only with that message: images and a still frame from a
        video go to the provider, small text files have their text read, and other files are listed by
        name and type. Saved notes are matched to the question and capped, and a long conversation sends
        the recent messages plus any older ones that are relevant, with a short summary instead of the
        whole thread. The coach shows a line under the header describing what was sent with the last
        question.
      </p>
      <p>
        The server that answers the question keeps no copy of the prompt or reply. It keeps a small
        counter of requests, tokens and estimated cost per day and per month, per anonymous install and
        per one-way hash of the account, so the spending limits can be enforced. That counter holds no
        message text, no email and no account id that can be reversed.
      </p>
      <p>
        One exception is worth knowing about. If you use the dictation button, the transcript comes
        from your browser's own speech recognition feature. Some browsers send that audio to their
        vendor's speech service, and that transfer is controlled by your browser, not by this app.
        Turn dictation off by not using the microphone button if you would rather avoid it.
      </p>
    </Section>

    <Section heading="Cookies">
      <p>
        This app sets one encrypted, HttpOnly, SameSite=Strict session cookie after you sign in. It
        contains a Supabase session so the server can refresh your login; it is not readable by page
        scripts and does not contain your journal. See the{' '}
        <Link to="/cookies" className="text-primary underline underline-offset-4">cookies page</Link>{' '}
        for the storage keys it uses.
      </p>
    </Section>

    <Section heading="How long it is kept">
      <p>
        Until you remove it. "Delete account" in Settings erases the local account record and its
        encrypted vault from this browser. The server account remains so the same verified identity
        can sign in again; it holds no journal entries. Clearing this site's data removes the rest.
        There is no backup, so deleted entries cannot be restored by anyone.
      </p>
    </Section>

    <Section heading="Your choices">
      <p>
        You can enter as little as you like: a name and an email address are the only details an
        account needs. The email identifies your verified account and is not used for marketing.
        You can lock
        the app at any time from Settings, and you can delete the account and its data there too.
      </p>
    </Section>

    <Section heading="The AI provider, and how long it keeps things">
      <p>
        The operator of this server chooses the provider. Whichever is used, the provider receives the
        message and the snapshot described above, and its own privacy terms apply. As at 1 November
        2026, the published positions are:
      </p>
      <ul className="space-y-1.5 pl-4 list-disc marker:text-border">
        <li>
          <span className="font-medium text-foreground">Freebuff</span>: requests go to the Freebuff
          API the operator has configured, and Freebuff's own privacy policy and terms apply. The
          app sends only the request described above and keeps no prompt text on the server.
        </li>
        <li>
          <span className="font-medium text-foreground">OpenAI</span>: API data is not used for
          training by default (since 1 March 2023), and abuse-monitoring logs may be kept for up to 30
          days. Zero data retention is available only with prior approval.
        </li>
        <li>
          <span className="font-medium text-foreground">Hugging Face router</span>: it does not store
          request bodies or responses and keeps debug logs for up to 30 days, but it forwards to an
          upstream vendor whose own policy applies. This app pins one vendor and does not use
          automatic routing.
        </li>
      </ul>
      <p>
        Requests may be processed outside Australia. That is a cross-border disclosure under
        Australian Privacy Principle 8, which is why the provider is named before you use the feature
        and why the assistant can be switched off entirely.
      </p>
    </Section>

    <Section heading="Safety, and what the assistant will not do">
      <p>
        Messages are checked before they are sent and replies are checked before they are shown, in
        the app's own code rather than only in the model's instructions. Requests for sexual content
        involving minors, weapon or explosive construction, drug synthesis, malware, self-harm methods
        and eating-disorder instructions are refused before any provider is called. Replies that
        contain those things are replaced. Attempts to make the assistant ignore its rules are treated
        as content, not commands.
      </p>
      <p>
        When a message suggests self-harm or suicide, the reply always ends with crisis contacts added
        by the server itself, so the numbers appear even if the model's own text does not include them.
        If you are in immediate danger, call 000 in Australia or your local emergency number.
      </p>
      <p>
        Saved notes and app data are treated as data, never as instructions. The assistant can propose
        a small set of app changes, but none of them happen until you read the proposal and confirm it.
      </p>
    </Section>

    <Section heading="Children and younger users">
      <p>
        The app has no age check and collects no birthday. The assistant has an age setting in Settings
        (adult, teen, under 13) that changes the rules it follows: for younger users it keeps topics
        age appropriate, refuses sexual, alcohol, drug and dieting content, and does not ask for
        identifying details. For children and teenagers the reply filter is stricter and replies are
        not streamed, so the whole answer can be checked before it is shown. That setting is a safety
        control, not verification.
      </p>
      <p>
        Australian privacy law treats information about a child as sensitive in practice: collection
        should be minimal, notice should be understandable to a young person, and a parent or carer
        should be able to see and delete what is stored. Everything the assistant remembers is visible
        and deletable in Settings, and memory is off when the switch is off. The Children's Online
        Privacy Code is expected to be registered by December 2026; this page will be updated when its
        obligations commence.
      </p>
      <p>
        Accounts are created on the device, so a parent or carer who sets one up is responsible for it.
        If you are under the age at which you can consent to online services where you live, use the
        app with a parent or carer.
      </p>
    </Section>

    <Section heading="Changes to this policy">
      <p>
        If the way the app handles data changes, this page will be updated with a new date before the
        change ships.
      </p>
    </Section>
  </LegalShell>
);

export const TermsAndConditions: React.FC = () => (
  <LegalShell
    title="Terms of use"
    summary="A short, plain agreement covering what this app is, what it is not, and what happens if a password is forgotten."
  >
    <Section heading="What this app is">
      <p>
        Serene Structure is a personal organisation tool: routines, time blocking, meals, movement,
        sleep, mood, cycle notes, journaling and a household budget. It runs on your device and stores
        what you type there.
      </p>
    </Section>

    <Section heading="What it is not">
      <p>
        It is not medical, psychological, dietary, fitness, legal or financial advice, and it is not a
        substitute for a professional who knows your situation. Calorie targets, cycle predictions,
        sleep summaries and budget figures are arithmetic on the numbers you enter, so they can be
        wrong. If you are in crisis, the support numbers on the Today screen connect you to real
        services; use them rather than this app.
      </p>
    </Section>

    <Section heading="The AI assistant">
      <p>
        The assistant can be wrong, can misunderstand you, and can produce confident text that is not
        true. Check anything that matters. It is not a therapist, doctor, dietitian, lawyer or financial
        adviser, and using it does not create that relationship.
      </p>
      <p>
        It is optional and can be turned off in Settings, in which case the coach falls back to replies
        built into the app. When it is on, messages are processed by a third-party AI provider chosen by
        whoever runs this server, and that provider's terms apply. Do not send it passwords, card
        numbers, addresses, identity documents or anyone else's private information.
      </p>
      <p>
        If you are in crisis, the assistant is not the right tool. Contact your local emergency number
        or a crisis line in your country.
      </p>
    </Section>

    <Section heading="Your journal password is the only key">
      <p>
        Entries are encrypted with a key derived from your journal password, not from your account
        password. You can reset the account password through Supabase if you forget it, but that does
        not re-encrypt or recover existing journal entries. Nothing is escrowed, so a forgotten
        journal password means those entries cannot be decrypted by you or anyone else. Keep it safe.
      </p>
    </Section>

    <Section heading="Your device, your responsibility">
      <p>
        The app can only protect data as well as the device it runs on. Anyone who can unlock your
        phone, or who has an unlocked browser profile with the session still open, may be able to read
        what the app has decrypted. Lock and sign out when you hand the phone to someone else, and
        keep your device passcode on.
      </p>
    </Section>

    <Section heading="Availability and changes">
      <p>
        The app is provided as it is, with no warranty that it will always work or that a feature will
        stay the same. Features may change or be removed. Where consumer law in your country gives you
        rights that cannot be excluded, those rights still apply and nothing here takes them away.
      </p>
    </Section>

    <Section heading="Acceptable use">
      <p>
        Use the app for your own personal records. Do not use it to store information you are legally
        required to keep elsewhere, and do not rely on it as the only copy of something you cannot
        afford to lose.
      </p>
    </Section>
  </LegalShell>
);

export const CookiePolicy: React.FC = () => (
  <LegalShell
    title="Cookies"
    summary="Serene Structure sets one session cookie for your verified account and runs no tracking. It uses your browser's local storage for encrypted entries, and this page lists every key."
  >
    <Section heading="The session cookie">
      <p>
        After you sign in, the server sets one <span className="font-medium text-foreground">HttpOnly,
        SameSite=Strict</span> session cookie. It holds a random session token, not your email, password
        or journal. It is required for AI credits and is not used for advertising or analytics. There
        is no tracking cookie and therefore no tracking consent banner.
      </p>
    </Section>

    <Section heading="Local storage, which is different">
      <p>
        Local storage is a key and value store inside your browser profile. It is not sent with
        requests, it is not visible to any other site, and it is not a cookie. The app uses it because
        that is where your encrypted vault lives.
      </p>
      <ul className="space-y-1.5 pl-4 list-disc marker:text-border">
        <li><span className="font-medium text-foreground">serene.accounts.v1</span>: name, email, salt and encrypted check value for accounts on this device.</li>
        <li><span className="font-medium text-foreground">serene.vault.v1.*</span>: your encrypted entries, one record per data type.</li>
        <li><span className="font-medium text-foreground">serene.onboarded.*</span>: whether the welcome screens have been seen for an account.</li>
        <li><span className="font-medium text-foreground">serene.session.v1</span>: the unlocked key, in session storage only, cleared when the tab closes.</li>
        <li><span className="font-medium text-foreground">serene.vault.v1.*.serene_ai_messages</span>: your assistant conversation, encrypted like everything else.</li>
        <li><span className="font-medium text-foreground">serene.vault.v1.*.serene_ai_memory</span>: the notes you asked the assistant to remember, encrypted.</li>
        <li><span className="font-medium text-foreground">serene-structure-settings</span>: theme, text size and your assistant preferences. Not encrypted, because it holds no entries.</li>
        <li><span className="font-medium text-foreground">serene_session</span>: the encrypted HttpOnly session cookie set by the server after sign-in. It is not readable by page scripts.</li>
      </ul>
    </Section>

    <Section heading="Third-party services">
      <p>
        Supabase Auth handles account registration, email verification and password reset. The
        selected AI provider receives only the AI request described above. No embedded video, map,
        font, payment widget, chat bubble or analytics script is loaded, so no other company can
        place anything in your browser through this app.
      </p>
    </Section>

    <Section heading="Clearing it">
      <p>
        Clearing site data for this origin deletes the account and every encrypted entry with it. If
        you only want to remove one account, use "Delete account" in Settings, which leaves the rest
        of the browser untouched.
      </p>
    </Section>
  </LegalShell>
);

export const About: React.FC = () => (
  <LegalShell
    title="About Serene Structure"
    summary="A small, offline life organiser for routines, health notes and a single inbox for whatever you need to write down."
  >
    <Section heading="What it does">
      <p>
        Plan the day, keep routines and streaks, log meals, movement, sleep and mood, note cycle
        phases, journal, and hold a simple budget. The capture box files what you type instead of
        asking you to choose a category first.
      </p>
    </Section>

    <Section heading="How it is built">
      <p>
        A React single-page app with a small Express server. Accounts, encryption and storage all run
        in the browser. The icon set, palette and type are part of the project, so the app loads with
        no third-party requests. The optional AI assistant is the only part that talks to another
        company, and its keys live on the server, never in this page.
      </p>
    </Section>

    <Section heading="Version">
      <p>1.0.0, web build. Policy pages last reviewed {LAST_UPDATED}.</p>
    </Section>

    <Section heading="Contact">
      <p>
        This build has no company, server or support inbox behind it, so no business address or phone
        number is published here. If you need to raise something about the app, use whichever channel
        it was supplied to you through. If you publish this build yourself, replace this paragraph
        with your own real contact details before you share it.
      </p>
    </Section>

    <Section heading="Credits">
      <p>
        Icons are drawn for this project. Type is the operating system's own sans and serif stacks.
        The app uses React, React Router, Tailwind CSS, date-fns and Motion, all under their own
        open-source licences.
      </p>
    </Section>
  </LegalShell>
);
