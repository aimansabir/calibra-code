def letter_grade(score):
    """Convert a score from 0 to 100 into a letter grade."""
    if score >= 60:
        return "D"
    elif score >= 70:
        return "C"
    elif score >= 80:
        return "B"
    elif score >= 90:
        return "A"
    else:
        return "F"


if __name__ == "__main__":
    print(letter_grade(95))
    print(letter_grade(65))
