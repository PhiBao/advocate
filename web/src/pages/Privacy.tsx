export default function Privacy() {
  return (
    <article className="prose" style={{ paddingTop: 24 }}>
      <h2>How we handle your data</h2>
      <p>
        Medical bills are sensitive. Advocate is designed so you don&rsquo;t have to trust us
        more than necessary:
      </p>
      <ul>
        <li>
          <strong>No account, no tracking profile.</strong> Your case lives behind a private,
          expiring link — whoever holds the link can view the case.
        </li>
        <li>
          <strong>We never need your Social Security number.</strong> Please black it out before
          uploading. If it slips through, tell us and we&rsquo;ll delete the file.
        </li>
        <li>
          <strong>Auto-deletion.</strong> Cases and uploaded files are automatically deleted after
          90 days via a daily sweep covering the database, file storage, and reminders.
        </li>
        <li>
          <strong>No training on your documents.</strong> Your bills are never used to train
          models.
        </li>
        <li>
          <strong>Nothing sent without you.</strong> No letter, email, or phone call goes to your
          insurer or provider without your explicit approval, every time.
        </li>
      </ul>
      <p>
        Advocate provides document preparation and advocacy assistance. It is not a law firm and
        does not provide legal or medical advice.
      </p>
      <p>
        <a href="#/">← Back to start a case</a>
      </p>
    </article>
  );
}
