        className="member-editor-dialog"
      >
        <form ref={memberFormRef} className="portal-form wizard-form" onInput={() => { setMemberRevision((value) => value + 1); readMemberStepValidity(); }} onChange={() => { setMemberRevision((value) => value + 1); readMemberStepValidity(); }} onSubmit={save}>
          <p className="wizard-subtitle">Add a new member to your team delegation.</p>
          <div className="wizard-topbar wizard-progress-bar" aria-label="Delegation member progress">
            {(admin ? ["Team","Full name","Date of birth","Member type","Photo","Notes","Consent"] : ["Full name","Date of birth","Member type","Photo","Notes","Consent"]).map((label, index) => { if ((!memberType && ["Playing role","Shirt number","Linked player","Classification"].includes(label)) || (memberType !== "PLAYER" && ["Playing role","Shirt number","Classification"].includes(label)) || (memberType !== "ASSISTANT" && label === "Linked player")) return null; return (
              <button type="button" key={label} disabled={index + 1 > memberStep + 1 || (index + 1 === memberStep + 1 && !memberStepValid)} className={memberStep === index + 1 ? "active" : memberStep > index + 1 ? "complete" : ""} onClick={() => { if (index + 1 <= memberStep + 1 && (index + 1 !== 1 || admin) && (index + 1 <= memberStep || memberStepValid)) setMemberStep(index + 1); }}>
                <span>{index + 1}</span>{label}
              </button>
            ); })}
          </div>
          <div className="wizard-content">
          <div className="wizard-question">
            <div className="wizard-question-icon"><UserRoundCog /></div>
            <h3>{memberStep === (admin ? 1 : 1) ? (admin ? "Which team is this member joining?" : "What is their full name?") : memberStep === (admin ? 2 : 1) ? "What is their full name?" : memberStep === (admin ? 3 : 2) ? "What is their date of birth?" : memberStep === (admin ? 4 : 3) ? "What is their member type?" : "Add the relevant details"}</h3>
            <p>Enter the information for this team member.</p>
          </div>
          {admin && <div hidden={memberStep !== 1}><Field label="Team" name="team_id" children={<select name="team_id" defaultValue={editing?.team_id || (team === "all" ? "" : team)} required><option value="">Choose team</option>{teams.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>} /></div>}
          <div hidden={memberStep !== (admin ? 2 : 1)}><Field label="Full name" name="name" defaultValue={editing?.name} placeholder="e.g. John Doe" required /></div>
          <div hidden={memberStep !== (admin ? 3 : 2)}><Field label="Date of birth" name="dob" type="date" defaultValue={editing?.dob} required /></div>
          <div className={`wizard-member-fields wizard-member-fields-${memberType.toLowerCase() || "empty"}`} hidden={memberStep !== (admin ? 4 : 3)}>
            {memberType === "REFEREE" ? (
              <div className="referee-fields">
                <label className="portal-field referee-type-field"><span>Member type<i className="required-mark" aria-hidden="true">*</i></span><select name="role" defaultValue={memberType} required onChange={(event) => { const next = event.target.value as typeof memberType; setMemberType(next); setMemberStepValid(false); setMemberRevision((value) => value + 1); }}><option value="">Choose member type</option><option value="PLAYER">Player</option><option value="COACH">Coach</option><option value="TEAM_MANAGER">Team Manager</option><option value="ASSISTANT">Assistant</option><option value="REFEREE">Referee</option></select></label>
                <label className="portal-field checkbox-field referee-wheelchair-field"><input type="hidden" name="wheelchair_user" value="0" /><input name="wheelchair_user" type="checkbox" value="1" defaultChecked={Boolean(editing?.wheelchair_user)} /><span>This referee uses a wheelchair</span></label>
              </div>
            ) : (
              <label className="portal-field referee-type-field"><span>Member type<i className="required-mark" aria-hidden="true">*</i></span><select name="role" defaultValue={memberType} required onChange={(event) => { const next = event.target.value as typeof memberType; setMemberType(next); setMemberStepValid(false); setMemberRevision((value) => value + 1); }}><option value="">Choose member type</option><option value="PLAYER">Player</option><option value="COACH">Coach</option><option value="TEAM_MANAGER">Team Manager</option><option value="ASSISTANT">Assistant</option><option value="REFEREE">Referee</option></select></label>
            )}
            <input type="hidden" name="member_type" value={memberType} />
            {memberType === "PLAYER" && <Field label="Playing role" name="player_role" children={<select name="player_role" defaultValue={editing?.player_role || "KEEPER"}><option value="KEEPER">Goalkeeper</option><option value="T_STICK">T-stick</option><option value="HANDSTICK">Handstick</option></select>} />}
            {memberType === "PLAYER" && <Field label="Shirt number" name="number" type="number" defaultValue={editing?.number} placeholder="e.g. 10" required />}
            {memberType === "ASSISTANT" && <Field label="Linked player (optional)" name="assistant_player_id" children={<select name="assistant_player_id" defaultValue={editing?.assistant_player_id || ""}><option value="">No linked player</option>{players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select>} />}
            {memberType === "PLAYER" && <Field label="Classification points (optional)" name="classification_points" type="number" defaultValue={editing?.classification_points ?? ""} placeholder="e.g. 2.5" min={0.5} max={4.5} step={0.5} />}
          </div>
          <div hidden={memberStep !== (admin ? 5 : 4)}><Field label="Portrait photo (optional)" name="photo_file" type="file" /></div>
          <div hidden={memberStep !== (admin ? 6 : 5)} className="wizard-final-fields"><Field label="Dietary requirements (optional)" name="dietary" defaultValue={editing?.dietary} placeholder="e.g. Vegetarian" /><label className="portal-field"><span>Notes (optional)</span><textarea name="notes" defaultValue={editing?.notes} placeholder="Add any relevant information" /></label></div>
          <div hidden={memberStep !== (admin ? 7 : 6)} className="wizard-consent-step"><div className="wizard-consent-grid"><VisibilityField label="Privacy consent" name="privacy_consent" defaultValue={editing?.privacy_consent ?? 0} onLabel="Granted" offLabel="Not granted" /><VisibilityField label="Photo publication consent" name="photo_consent" defaultValue={editing?.photo_consent ?? 0} onLabel="Granted" offLabel="Not granted" /></div></div>
          </div>
          <div className="wizard-footer"><div className="wizard-actions">{memberStep > 1 && <button type="button" className="btn" onClick={() => setMemberStep((step) => step - 1)}>Back</button>}{memberStep < (admin ? 7 : 6) ? <button type="button" className="btn primary" disabled={!memberStepValid} onClick={() => setMemberStep((step) => step + 1)}>Next</button> : <FormButtons busy={busy} onCancel={() => setEditing(undefined)} />}</div></div>
        </form>
      </Modal>
    </section>
  );
}

function RoomsPanelV2({
  refresh,
  admin = false,
}: {
  refresh: number;
  admin?: boolean;
}) {
  const rooms = useData("/rooms", refresh),
    members = useData("/delegation", refresh),
    teams = useData("/teams", refresh),
    [editing, setEditing] = useState<Row | null | undefined>(undefined),
    [memberId, setMemberId] = useState(""),
    [roomId, setRoomId] = useState("");
  const assignedMemberIds = useMemo(
    () =>
      new Set(