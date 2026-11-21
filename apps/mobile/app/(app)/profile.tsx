import { Link } from "expo-router";
import { Body, Button, Screen, Title } from "../../src/ui";
export default function Profile() {
  return (
    <Screen>
      <Title>My RentMate profile</Title>
      <Body>Manage the information people see when they discover you.</Body>
      <Body>
        Next profile milestone: editable photos, introduction, interests, languages, activities, dating
        preferences and companion availability.
      </Body>
      <Body>
        Verification must be clearly distinguished from the 18+ self-declaration. A date-of-birth declaration
        is not identity verification.
      </Body>
      <Link href="/settings" asChild>
        <Button label="Account and privacy settings" onPress={() => undefined} />
      </Link>
    </Screen>
  );
}
