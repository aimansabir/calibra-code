def letter_grade(score):
    """Convert a score from 0 to 100 into a letter grade."""
    if score >= 90:
        return "A"
    elif score >= 80:
        return "B"
    elif score >= 70:
        return "C"
    elif score >= 60:
        return "D"
    else:
        return "F"


if __name__ == "__main__":
    print(letter_grade(95))
    print(letter_grade(65))
